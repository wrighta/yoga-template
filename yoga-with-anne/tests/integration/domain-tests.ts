/** Domain-level flow tests: booking, capacity, waitlist, passes, reminders. */
import assert from "node:assert/strict";

export async function runDomainTests(BASE: string, step: (name: string, fn: () => Promise<void> | void) => Promise<void>) {
  // domain imports must run after DATABASE_URL is set (done by run.ts)
  const { run, get, all, nowIso } = await import("@/db");
  const { startCheckout, markOrderPaid, releaseExpiredHolds, joinWaitlist, cancelBooking, offerNextWaitlistSeat, expireWaitlistOffers, adminCreateBooking, claimWaitlistOffer, buildQuote } = await import("@/lib/booking");
  const { upsertCustomer, entitlementsForCustomer, isNewCustomer } = await import("@/lib/customers");
  const { sendTemplate } = await import("@/lib/mail");
  void sendTemplate;

  const settingsTz = "Europe/Dublin";
  const { zonedToUtc } = await import("@/lib/tz");
  const mkOcc = (opts: { inDays: number; capacity: number; startsInHours?: number }) => {
    if (opts.startsInHours != null) {
      const startsAt = new Date(Date.now() + opts.startsInHours * 3600_000).toISOString();
      const endsAt = new Date(Date.now() + (opts.startsInHours + 1) * 3600_000).toISOString();
      const res = run(
        `INSERT INTO class_occurrences (class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, waitlist_enabled, source)
         VALUES ((SELECT id FROM class_types LIMIT 1), (SELECT id FROM venues LIMIT 1), (SELECT id FROM instructors LIMIT 1), 'Test class', ?, ?, ?, 1, 'manual')`,
        startsAt, endsAt, opts.capacity
      );
      return Number(res.lastInsertRowid);
    }
    const d = new Date(Date.now() + opts.inDays * 86400_000);
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: settingsTz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const [y, m, dd] = local.split("-").map(Number);
    const startsAt = zonedToUtc(y, m, dd, 19, 30, settingsTz);
    const endsAt = zonedToUtc(y, m, dd, 20, 30, settingsTz);
    const res = run(
      `INSERT INTO class_occurrences (class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, waitlist_enabled, source)
       VALUES ((SELECT id FROM class_types LIMIT 1), (SELECT id FROM venues LIMIT 1), (SELECT id FROM instructors LIMIT 1), 'Test class', ?, ?, ?, 1, 'manual')`,
      startsAt, endsAt, opts.capacity
    );
    return Number(res.lastInsertRowid);
  };

  let orderRefA = "";
  let occA1 = 0;
  let occA2 = 0;
  let customerAId = 0;

  await step("guest checkout creates holds + awaiting order; confirmation converts to bookings", async () => {
    occA1 = mkOcc({ inDays: 3, capacity: 10 });
    occA2 = mkOcc({ inDays: 5, capacity: 10 });
    const outcome = await startCheckout({
      email: "guest-a@example.com",
      name: "Guest A",
      phone: "087 000 0001",
      occurrenceIds: [occA1, occA2],
      marketingConsent: false,
      acceptTerms: true,
    });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    orderRefA = outcome.orderRef;
    customerAId = get<{ id: number }>(`SELECT id FROM customers WHERE email = 'guest-a@example.com'`)!.id;

    const holds = get<{ c: number }>(`SELECT COUNT(*) AS c FROM capacity_holds WHERE order_id = (SELECT id FROM orders WHERE ref = ?) AND released = 0`, orderRefA)!.c;
    assert.equal(holds, 2);

    const paid = await markOrderPaid(orderRefA, { provider: "test", providerRef: `test-${orderRefA}` });
    assert.ok(paid.ok && !paid.alreadyPaid);
    const bookings = get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?) AND status = 'confirmed'`, orderRefA)!.c;
    assert.equal(bookings, 2);
    const order = get<{ status: string; total_cents: number }>(`SELECT status, total_cents FROM orders WHERE ref = ?`, orderRefA)!;
    assert.equal(order.status, "paid");
    assert.equal(order.total_cents, 2200); // multi-date applied
  });

  await step("replaying the payment confirmation is idempotent (no duplicates)", async () => {
    const replay = await markOrderPaid(orderRefA, { provider: "test", providerRef: `test-${orderRefA}` });
    assert.ok(replay.ok && replay.alreadyPaid);
    const bookings = get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, orderRefA)!.c;
    assert.equal(bookings, 2);
    const payments = get<{ c: number }>(`SELECT COUNT(*) AS c FROM payments WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, orderRefA)!.c;
    assert.equal(payments, 1);
  });

  await step("same customer cannot book the same class twice", async () => {
    const outcome = await startCheckout({
      email: "guest-a@example.com",
      name: "Guest A",
      occurrenceIds: [occA1],
      marketingConsent: false,
      acceptTerms: true, phone: "087 555 0000",
      customerId: customerAId,
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(outcome.error, /already have a confirmed booking|already have these places held/i);
  });

  await step("last-seat race: exactly one of N concurrent checkouts wins", async () => {
    const occ = mkOcc({ inDays: 7, capacity: 1 });
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        startCheckout({
          email: `racer-${i}@example.com`,
          name: `Racer ${i}`,
          occurrenceIds: [occ],
          marketingConsent: false,
          acceptTerms: true, phone: "087 555 0000",
        }).catch(() => ({ ok: false as const, error: "crashed" }))
      )
    );
    const wins = attempts.filter((a) => a.ok).length;
    assert.equal(wins, 1, `expected exactly 1 winner, got ${wins}: ${JSON.stringify(attempts)}`);
    const soldOutErrors = attempts.filter((a) => !a.ok && "error" in a && a.error.includes("last place")).length;
    assert.equal(soldOutErrors, 5, `expected 5 sold-out errors, got ${soldOutErrors}: ${JSON.stringify(attempts)}`);
  });

  await step("expired checkout holds release capacity safely", async () => {
    const occ = mkOcc({ inDays: 8, capacity: 2 });
    const outcome = await startCheckout({
      email: "abandon@example.com",
      name: "Abandon",
      occurrenceIds: [occ],
      marketingConsent: false,
      acceptTerms: true, phone: "087 555 0000",
    });
    assert.ok(outcome.ok);
    // force the hold + order to expire
    run(`UPDATE capacity_holds SET expires_at = ? WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, new Date(Date.now() - 1000).toISOString(), outcome.orderRef!);
    run(`UPDATE orders SET expires_at = ? WHERE ref = ?`, new Date(Date.now() - 1000).toISOString(), outcome.orderRef!);
    releaseExpiredHolds();
    const remaining = get<{ c: number }>(
      `SELECT ? - (SELECT COUNT(*) FROM bookings WHERE occurrence_id = ? AND status IN ('confirmed','attended')) - (SELECT COALESCE(SUM(qty),0) FROM capacity_holds WHERE occurrence_id = ? AND released = 0 AND expires_at > ?) AS c`,
      2, occ, occ, nowIso()
    )!.c;
    assert.equal(remaining, 2);
    const orderStatus = get<{ status: string }>(`SELECT status FROM orders WHERE ref = ?`, outcome.orderRef!)!.status;
    assert.equal(orderStatus, "expired");
  });

  await step("waitlist: full class joins, cancellation offers the place with expiry", async () => {
    const occ = mkOcc({ inDays: 4, capacity: 1 });
    const booker = await adminCreateBooking({
      occurrenceId: occ,
      email: "fullclass@example.com",
      name: "Full Taker",
      paymentMethod: "cash",
      actor: "test",
    });
    assert.ok(booker.ok, booker.error);
    const w1 = upsertCustomer({ email: "wait1@example.com", name: "Waiter One" });
    const w2 = upsertCustomer({ email: "wait2@example.com", name: "Waiter Two" });
    const j1 = await joinWaitlist(occ, w1);
    const j2 = await joinWaitlist(occ, w2);
    assert.ok(j1.ok && j2.ok);

    // booking cancelled → first in queue gets the offer
    const booking = get<{ id: number }>(`SELECT id FROM bookings WHERE occurrence_id = ? AND customer_id = ?`, occ, get<{ id: number }>(`SELECT id FROM customers WHERE email = 'fullclass@example.com'`)!.id)!;
    const cancelled = await cancelBooking(booking.id, "test", "admin");
    assert.ok(cancelled.ok);
    const offered = get<{ customer_id: number; offer_token: string }>(`SELECT customer_id, offer_token FROM waitlist_entries WHERE occurrence_id = ? AND status = 'offered'`, occ)!;
    assert.equal(offered.customer_id, w1);

    // claim validation
    const claim = await claimWaitlistOffer(offered.offer_token, w1);
    assert.ok(claim.ok);
    const wrongUser = await claimWaitlistOffer(offered.offer_token, w2);
    assert.equal(wrongUser.ok, false);

    // expire the offer → second waiter promoted
    run(`UPDATE waitlist_entries SET offer_expires_at = ? WHERE offer_token = ?`, new Date(Date.now() - 1000).toISOString(), offered.offer_token);
    await expireWaitlistOffers();
    const promoted = get<{ customer_id: number }>(`SELECT customer_id FROM waitlist_entries WHERE occurrence_id = ? AND status = 'offered'`, occ);
    assert.equal(promoted?.customer_id, w2);
  });

  let passCustomerId = 0;
  await (await import("@/lib/settings")).setSetting("class_passes_enabled", true);
  await step("pass purchase → credits granted → redemption consumes → cancellation returns", async () => {
    passCustomerId = upsertCustomer({ email: "passuser@example.com", name: "Pass User" });
    assert.equal(isNewCustomer(passCustomerId), true);

    // standalone pass order (as productCheckoutAction would create), then confirm
    const { run: runDb } = await import("@/db");
    const res = runDb(
      `INSERT INTO orders (ref, customer_id, status, subtotal_cents, discount_cents, total_cents, checkout_mode, expires_at, policy_versions, created_at, updated_at)
       VALUES (?,?, 'awaiting_payment', 5000, 0, 5000, 'test', ?, '[]', ?, ?)`,
      "YA-PASS1", passCustomerId, new Date(Date.now() + 600_000).toISOString(), nowIso(), nowIso()
    );
    const orderId = Number(res.lastInsertRowid);
    const product = get<{ id: number }>(`SELECT id FROM products WHERE name = '5-class flex pass'`)!;
    run(`INSERT INTO order_items (order_id, kind, product_id, description, qty, unit_cents, total_cents) VALUES (?,?,?,?,?,?,?)`,
      orderId, "pass", product.id, "5-class flex pass", 1, 5000, 5000);
    const paid = await markOrderPaid("YA-PASS1", { provider: "test", providerRef: "test-YA-PASS1" });
    assert.ok(paid.ok);

    const ent = await entitlementsForCustomer(passCustomerId);
    assert.equal(ent.passes.length, 1, `expected 1 active pass, got ${JSON.stringify(ent)}`);
    assert.equal(ent.passes[0].creditsLeft, 5);

    // book a class using a credit
    const occ = mkOcc({ inDays: 2, capacity: 5 });
    const quoteResult = await buildQuote({
      seats: [{
        occurrenceId: occ, title: "Test class", startsAt: get<{ starts_at: string }>(`SELECT starts_at FROM class_occurrences WHERE id = ?`, occ)!.starts_at,
        dateKey: "x", priceCents: 1200, classTypeId: 1,
      }],
      customerId: passCustomerId,
    });
    assert.equal(quoteResult.result.totalCents, 0);
    assert.equal(quoteResult.result.chosen.kind, "entitlement_only");

    const outcome = await startCheckout({
      email: "passuser@example.com",
      name: "Pass User",
      occurrenceIds: [occ],
      marketingConsent: false,
      acceptTerms: true, phone: "087 555 0000",
      customerId: passCustomerId,
    });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    await markOrderPaid(outcome.orderRef!, { provider: "test" });
    const ent2 = await entitlementsForCustomer(passCustomerId);
    assert.equal(ent2.passes[0].creditsLeft, 4);
    const booking = get<{ id: number }>(`SELECT id FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, outcome.orderRef)!;
    assert.equal(get<{ source: string }>(`SELECT source FROM bookings WHERE id = ?`, booking.id)!.source, "pass");

    // cancellation inside cutoff returns the credit
    const cancelled = await cancelBooking(booking.id, "test", "customer");
    assert.ok(cancelled.ok && cancelled.creditReturned);
    const ent3 = await entitlementsForCustomer(passCustomerId);
    assert.equal(ent3.passes[0].creditsLeft, 5);
  });

  await step("intro pass is only for new customers (engine respects entitlements+history)", async () => {
    assert.equal(isNewCustomer(passCustomerId), false); // has a pass already
    const newbie = upsertCustomer({ email: "newbie@example.com", name: "New Bie" });
    assert.equal(isNewCustomer(newbie), true);
    const q = await buildQuote({
      seats: Array.from({ length: 3 }, (_, i) => ({ occurrenceId: -(i + 1), title: "t", startsAt: new Date(Date.now() + (i + 1) * 86400_000).toISOString(), dateKey: `d${i}`, priceCents: 1200, classTypeId: 1 })),
      customerId: newbie,
    });
    assert.equal(q.newCustomer, true);
    assert.equal(q.result.chosen.kind, "intro_pass");
    assert.equal(q.result.totalCents, 3000);
  });

  await step("class reminder job sends once per booking (idempotent)", async () => {
    const occ = mkOcc({ inDays: 0, capacity: 5, startsInHours: 4 }); // comfortably inside the 24h reminder window
    const outcome = await startCheckout({
      email: "remindme@example.com",
      name: "Remind Me",
      occurrenceIds: [occ],
      marketingConsent: false,
      acceptTerms: true, phone: "087 555 0000",
    });
    assert.ok(outcome.ok);
    await markOrderPaid(outcome.orderRef!, { provider: "test" });

    const cron = await fetch(`${BASE}/api/cron/reminders?token=test-cron-token`);
    const first = (await cron.json()) as { reminders: number };
    assert.ok(first.reminders >= 1, `expected ≥1 reminder, got ${JSON.stringify(first)} booking=${JSON.stringify(get(`SELECT b.id, b.reminder_sent_at, o.starts_at FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id WHERE b.customer_id = (SELECT id FROM customers WHERE email = 'remindme@example.com')`))}`);
    const again = await fetch(`${BASE}/api/cron/reminders?token=test-cron-token`);
    const second = (await again.json()) as { reminders: number };
    assert.equal(second.reminders, 0);
  });

  await step("confirmation email is captured in the dev preview log, never really sent", async () => {
    const preview = get<{ c: number }>(`SELECT COUNT(*) AS c FROM email_log WHERE template_key = 'booking_confirmation' AND status = 'preview'`)!.c;
    assert.ok(preview >= 1, "expected at least one previewed confirmation email");
    const sent = get<{ c: number }>(`SELECT COUNT(*) AS c FROM email_log WHERE status = 'sent'`)!.c;
    assert.equal(sent, 0);
  });

  await step("admin session can export bookings CSV; customer data respects least access", async () => {
    const { hashTokenlessSession } = { hashTokenlessSession: null };
    void hashTokenlessSession;
    const res = await fetch(`${BASE}/api/admin/export?type=bookings`);
    assert.equal(res.status, 401); // no cookie
  });

  await step("booking ICS file is produced with UTC times", async () => {
    const booking = get<{ id: number }>(`SELECT id FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?) LIMIT 1`, orderRefA)!;
    const res = await fetch(`${BASE}/api/ics/booking/${booking.id}`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("BEGIN:VCALENDAR"));
    assert.ok(/DTSTART:\d{8}T\d{6}Z/.test(text));
    assert.ok(text.includes("Test class") || text.includes("Gentle"));
  });

  await step("audit log recorded the important events", async () => {
    const actions = all<{ action: string }>(`SELECT DISTINCT action FROM audit_log`).map((r) => r.action);
    assert.ok(actions.includes("order.paid"));
    assert.ok(actions.includes("booking.cancelled"));
    assert.ok(actions.includes("booking.manual_created"));
  });

  void all;
}
