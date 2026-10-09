/**
 * Regression tests for the final adversarial fix pass.
 * Every named defect gets a reproduction-style test against the real DB.
 */
import assert from "node:assert/strict";

export async function runFixPassTests(BASE: string, step: (name: string, fn: () => Promise<void> | void) => Promise<void>) {
  const { all, get, run, nowIso } = await import("@/db");
  const { parseEuroInputToCents } = await import("@/lib/money");
  const { getDropInPriceCents, getWeeklyScheduleSummary, setSetting } = await import("@/lib/settings");
  const { startCheckout, markOrderPaid, buildQuote, releaseExpiredHolds, adminCreateBooking, adminCreateBlockBooking, cancelOccurrence, transferEventBooking, recordRefund, remainingRefundable, sendOrderConfirmation } = await import("@/lib/booking");
  const { addDaysLocal, zonedToUtc, utcToZoned, generateOccurrences } = await import("@/lib/tz");
  const { upsertCustomer } = await import("@/lib/customers");
  const { getOccurrenceView, listUpcoming } = await import("@/lib/schedule");
  const { handleInvoicePaid, handleInvoicePaymentFailed, handleSubscriptionDeleted } = await import("@/lib/stripe-events");
  const { escapeHtml } = await import("@/lib/mail");

  await setSetting("class_passes_enabled", true);

  const mkOcc = (opts: { inDays: number; capacity: number; classTypeId?: number; priceOverride?: number | null; publicationStatus?: "draft" | "published"; title?: string }) => {
    const d = new Date(Date.now() + opts.inDays * 86400_000);
    const startsAt = new Date(d.getTime() + 3600_000).toISOString();
    const endsAt = new Date(d.getTime() + 2 * 3600_000).toISOString();
    const res = run(
      `INSERT INTO class_occurrences (class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, waitlist_enabled, price_override_cents, publication_status, source)
       VALUES (?, (SELECT id FROM venues LIMIT 1), (SELECT id FROM instructors LIMIT 1), ?, ?, ?, ?, 1, ?, ?, 'manual')`,
      opts.classTypeId ?? (get<{ id: number }>(`SELECT id FROM class_types LIMIT 1`)!.id),
      opts.title ?? "Fixpass class", startsAt, endsAt, opts.capacity, opts.priceOverride ?? null, opts.publicationStatus ?? "published"
    );
    return Number(res.lastInsertRowid);
  };

  // ---------- #3 canonical drop-in price ----------
  await step("canonical drop-in price: product edit propagates to quote + checkout + public page", async () => {
    const product = get<{ id: number; price_cents: number }>(`SELECT id, price_cents FROM products WHERE kind = 'drop_in' ORDER BY id LIMIT 1`)!;
    const original = product.price_cents;
    try {
      // owner path = the same UPDATE the pricing admin action performs
      run(`UPDATE products SET price_cents = 1300 WHERE id = ?`, product.id);
      assert.equal(await getDropInPriceCents(), 1300);
      const occ = mkOcc({ inDays: 3, capacity: 5 });
      const q = await buildQuote({ seats: [{ occurrenceId: occ, title: "t", startsAt: new Date(Date.now() + 86400_000).toISOString(), dateKey: "d", priceCents: 1300, classTypeId: 1 }] });
      assert.equal(q.result.totalCents, 1300);
      const outcome = await startCheckout({
        email: "price-check@example.com", name: "Price Check", occurrenceIds: [occ],
        marketingConsent: false, acceptTerms: true, phone: "087 555 0000",
      });
      assert.ok(outcome.ok, JSON.stringify(outcome));
      if (!outcome.ok) return;
      const total = get<{ total_cents: number }>(`SELECT total_cents FROM orders WHERE ref = ?`, outcome.orderRef)!.total_cents;
      assert.equal(total, 1300);
      // public prices page reflects it
      const html = await (await fetch(`${BASE}/prices`)).text();
      assert.ok(html.includes("€13.00"), "public prices page should show €13.00");
    } finally {
      run(`UPDATE products SET price_cents = ? WHERE id = ?`, original, product.id);
    }
    assert.equal(await getDropInPriceCents(), original);
  });

  await step("class-specific price override still wins over canonical price", async () => {
    const occ = mkOcc({ inDays: 4, capacity: 5, priceOverride: 900 });
    const view = await (await import("@/lib/schedule")).getOccurrenceView(occ);
    assert.equal(view!.effective_price_cents, 900);
  });

  // ---------- #4 series override euros→cents ----------
  await step("parseEuroInputToCents converts admin euro input exactly", async () => {
    assert.equal(parseEuroInputToCents("12"), 1200);
    assert.equal(parseEuroInputToCents("12.50"), 1250);
    assert.equal(parseEuroInputToCents("€12"), 1200);
    assert.equal(parseEuroInputToCents(""), null);
    assert.equal(parseEuroInputToCents("abc"), null);
    assert.equal(parseEuroInputToCents("-5"), null);
    assert.equal(parseEuroInputToCents("0"), 0);
  });

  // ---------- #13 DST-safe duplication ----------
  await step("addDaysLocal keeps 19:30 local across both Irish DST boundaries", () => {
    // October: clocks go back 25 Oct 2026 - a Tue 27 Oct class duplicates to Tue 3 Nov at 19:30 local
    const before = zonedToUtc(2026, 10, 27, 19, 30, "Europe/Dublin");
    const dup = addDaysLocal(before, 7, "Europe/Dublin");
    assert.equal(utcToZoned(dup, "Europe/Dublin").hour, 19);
    assert.equal(utcToZoned(dup, "Europe/Dublin").day, 3);
    // March: clocks go forward 29 Mar 2026
    const beforeMarch = zonedToUtc(2026, 3, 26, 19, 30, "Europe/Dublin"); // Thu before change (GMT)
    const dupMarch = addDaysLocal(beforeMarch, 7, "Europe/Dublin"); // Thu after change (IST)
    assert.equal(utcToZoned(dupMarch, "Europe/Dublin").hour, 19);
    assert.equal(utcToZoned(dupMarch, "Europe/Dublin").day, 2);
    // ordinary week: same UTC offset shift
    const ordinary = addDaysLocal("2026-06-10T18:30:00.000Z", 7, "Europe/Dublin");
    assert.equal(ordinary, "2026-06-17T18:30:00.000Z");
  });

  // ---------- #5 policy fail-closed ----------
  await step("required booking terms draft BLOCKS checkout; published allows it; acceptance recorded", async () => {
    const occ = mkOcc({ inDays: 5, capacity: 5 });
    // seed leaves booking-terms DRAFT → force that state
    run(`UPDATE policies SET status = 'draft' WHERE slug = 'booking-terms'`);
    const blocked = await startCheckout({
      email: "policy@example.com", name: "Policy", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000",
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /temporarily unavailable/);
    // publish → checkout proceeds
    run(`UPDATE policies SET status = 'published', requires_acceptance = 1 WHERE slug = 'booking-terms'`);
    const ok = await startCheckout({
      email: "policy@example.com", name: "Policy", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000",
    });
    assert.ok(ok.ok, JSON.stringify(ok));
    const paid = await markOrderPaid(ok.orderRef!, { provider: "test", providerRef: `test-${ok.orderRef}` });
    assert.ok(paid.ok);
    const accepted = get<{ version: number }>(
      `SELECT version FROM policy_acceptances WHERE order_id = (SELECT id FROM orders WHERE ref = ?) AND policy_slug = 'booking-terms'`,
      ok.orderRef!
    );
    assert.ok(accepted, "policy acceptance must be recorded with the order");
    assert.equal(accepted.version, get<{ version: number }>(`SELECT version FROM policies WHERE slug = 'booking-terms'`)!.version);
  });

  // ---------- #2 Stripe membership subscription lifecycle ----------
  await step("membership checkout persists the real Stripe subscription id; lifecycle handlers track it", async () => {
    const customerId = upsertCustomer({ email: "subuser@example.com", name: "Sub User" });
    const product = get<{ id: number; recurrence: string | null; name: string; price_cents: number }>(`SELECT * FROM products WHERE kind = 'membership' AND recurrence = 'monthly' LIMIT 1`)!;
    const res = run(
      `INSERT INTO orders (ref, customer_id, status, subtotal_cents, total_cents, checkout_mode, expires_at, policy_versions, created_at, updated_at)
       VALUES (?,?, 'awaiting_payment', ?, ?, 'stripe', ?, '[]', ?, ?)`,
      "YA-SUB1", customerId, product.price_cents, product.price_cents,
      new Date(Date.now() + 600_000).toISOString(), nowIso(), nowIso()
    );
    const orderId = Number(res.lastInsertRowid);
    run(`INSERT INTO order_items (order_id, kind, product_id, description, qty, unit_cents, total_cents) VALUES (?,?,?,?,?,?,?)`,
      orderId, "membership", product.id, product.name, 1, product.price_cents, product.price_cents);

    // checkout.session.completed carries the subscription id INTO markOrderPaid
    const paid = await markOrderPaid("YA-SUB1", { provider: "stripe", providerRef: "pi_sub1", amountCents: product.price_cents }, { subscriptionId: "sub_TEST123" });
    assert.ok(paid.ok, JSON.stringify(paid));
    const membership = get<{ stripe_subscription_id: string | null; status: string; current_period_end: string }>(
      `SELECT stripe_subscription_id, status, current_period_end FROM memberships WHERE order_id = ?`, orderId
    )!;
    assert.equal(membership.stripe_subscription_id, "sub_TEST123", "subscription id must be persisted atomically with activation");
    assert.equal(membership.status, "active");

    // duplicate completion stays idempotent and does NOT lose the id
    await markOrderPaid("YA-SUB1", { provider: "stripe", providerRef: "pi_sub1" }, { subscriptionId: "sub_TEST123" });
    assert.equal(get<{ stripe_subscription_id: string }>(`SELECT stripe_subscription_id FROM memberships WHERE order_id = ?`, orderId)!.stripe_subscription_id, "sub_TEST123");

    // renewal
    await handleInvoicePaid({ subscription: "sub_TEST123" });
    const renewed = get<{ status: string; current_period_end: string }>(`SELECT status, current_period_end FROM memberships WHERE stripe_subscription_id = 'sub_TEST123'`)!;
    assert.equal(renewed.status, "active");
    assert.ok(new Date(renewed.current_period_end) > new Date(membership.current_period_end), "renewal extends the period");

    // payment failure
    await handleInvoicePaymentFailed({ subscription: "sub_TEST123" });
    assert.equal(get<{ status: string }>(`SELECT status FROM memberships WHERE stripe_subscription_id = 'sub_TEST123'`)!.status, "past_due");

    // deletion
    await handleSubscriptionDeleted({ id: "sub_TEST123" });
    assert.equal(get<{ status: string }>(`SELECT status FROM memberships WHERE stripe_subscription_id = 'sub_TEST123'`)!.status, "cancelled");

    // unknown subscription ids are ignored harmlessly
    await handleInvoicePaid({ subscription: "sub_unknown" });
    await handleInvoicePaymentFailed({ subscription: "sub_unknown" });
    await handleSubscriptionDeleted({ id: "sub_unknown" });
  });

  // ---------- #6 late Stripe payment ----------
  await step("late payment with seats still free: order recovers and fulfils", async () => {
    const occ = mkOcc({ inDays: 6, capacity: 3 });
    const outcome = await startCheckout({ email: "late-ok@example.com", name: "Late OK", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000" });
    assert.ok(outcome.ok);
    // local expiry
    run(`UPDATE orders SET expires_at = ? WHERE ref = ?`, new Date(Date.now() - 1000).toISOString(), outcome.orderRef!);
    run(`UPDATE capacity_holds SET expires_at = ? WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, new Date(Date.now() - 1000).toISOString(), outcome.orderRef!);
    releaseExpiredHolds();
    assert.equal(get<{ status: string }>(`SELECT status FROM orders WHERE ref = ?`, outcome.orderRef!)!.status, "expired");
    // Stripe completes late
    const paid = await markOrderPaid(outcome.orderRef!, { provider: "stripe", providerRef: "pi_late_ok", amountCents: 1200 });
    assert.ok(paid.ok && paid.lateRecovered, JSON.stringify(paid));
    assert.equal(get<{ status: string }>(`SELECT status FROM orders WHERE ref = ?`, outcome.orderRef!)!.status, "paid");
    assert.equal(get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?) AND status='confirmed'`, outcome.orderRef!)!.c, 1);
  });

  await step("late payment with seats GONE: refund_required, never paid-but-silent", async () => {
    const occ = mkOcc({ inDays: 7, capacity: 1 });
    const outcome = await startCheckout({ email: "late-lost@example.com", name: "Late Lost", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000" });
    assert.ok(outcome.ok);
    run(`UPDATE orders SET expires_at = ? WHERE ref = ?`, new Date(Date.now() - 1000).toISOString(), outcome.orderRef!);
    run(`UPDATE capacity_holds SET expires_at = ? WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, new Date(Date.now() - 1000).toISOString(), outcome.orderRef!);
    releaseExpiredHolds();
    // someone else takes the released seat
    const taker = await adminCreateBooking({ occurrenceId: occ, email: "taker@example.com", name: "Seat Taker", paymentMethod: "cash", actor: "fixpass" });
    assert.ok(taker.ok);
    // the original Stripe session completes late
    const paid = await markOrderPaid(outcome.orderRef!, { provider: "stripe", providerRef: "pi_late_lost", amountCents: 1200 });
    assert.equal(paid.ok, false);
    assert.equal(paid.refundRequired, true);
    assert.equal(get<{ recovery: string }>(`SELECT recovery FROM orders WHERE ref = ?`, outcome.orderRef!)!.recovery, "refund_required");
    assert.equal(get<{ status: string }>(`SELECT status FROM orders WHERE ref = ?`, outcome.orderRef!)!.status, "expired");
    const charge = get<{ status: string; amount_cents: number }>(`SELECT status, amount_cents FROM payments WHERE provider_ref = 'pi_late_lost'`)!;
    assert.equal(charge.status, "succeeded"); // money WAS taken - recorded honestly
    assert.equal(charge.amount_cents, 1200);
    // no booking for the payer
    assert.equal(get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE c.email = 'late-lost@example.com' AND b.status = 'confirmed'`)!.c, 0);
    // the taker still holds the seat (no oversell)
    assert.equal(get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE occurrence_id = ? AND status = 'confirmed'`, occ)!.c, 1);
    // replay is safe
    const replay = await markOrderPaid(outcome.orderRef!, { provider: "stripe", providerRef: "pi_late_lost" });
    assert.equal(replay.alreadyPaid, true);
  });

  // ---------- #7 cancellation settlement ----------
  await step("organiser class cancellation settles every booking source exactly once", async () => {
    const occ = mkOcc({ inDays: 8, capacity: 8 });
    // 1. cash booking
    await adminCreateBooking({ occurrenceId: occ, email: "cash@example.com", name: "Cash", paymentMethod: "cash", actor: "fixpass" });
    // 2. online paid booking
    const online = await startCheckout({ email: "online@example.com", name: "Online", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000" });
    assert.ok(online.ok, JSON.stringify(online));
    if (online.ok) await markOrderPaid(online.orderRef, { provider: "test", providerRef: `test-${online.orderRef}` });
    // 3. pass-credit booking
    const passCustomer = upsertCustomer({ email: "passcancel@example.com", name: "Pass Cancel" });
    const passProduct = get<{ id: number; credits: number }>(`SELECT id, credits FROM products WHERE kind='pass' AND eligibility='all' LIMIT 1`)!;
    const pres = run(`INSERT INTO passes (customer_id, product_id, credits_total, valid_from, expires_at, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      passCustomer, passProduct.id, passProduct.credits, nowIso(), new Date(Date.now() + 30 * 86400_000).toISOString(), "active", nowIso(), nowIso());
    const passId = Number(pres.lastInsertRowid);
    run(`INSERT INTO pass_credit_ledger (pass_id, delta, reason, actor, created_at) VALUES (?, ?, 'purchase', 'system', ?)`, passId, passProduct.credits, nowIso());
    const passOcc = mkOcc({ inDays: 9, capacity: 5 });
    void passOcc;
    // book occ with the pass via entitlement quote
    const occRow = get<{ starts_at: string }>(`SELECT starts_at FROM class_occurrences WHERE id = ?`, occ)!;
    const q = await buildQuote({ seats: [{ occurrenceId: occ, title: "t", startsAt: occRow.starts_at, dateKey: "d", priceCents: 1200, classTypeId: 1 }], customerId: passCustomer });
    assert.equal(q.result.totalCents, 0, "pass should cover the seat");
    const passOutcome = await startCheckout({ email: "passcancel@example.com", name: "Pass Cancel", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000", customerId: passCustomer });
    assert.ok(passOutcome.ok, JSON.stringify(passOutcome));
    if (passOutcome.ok) await markOrderPaid(passOutcome.orderRef, { provider: "test" });
    const creditsAfterUse = get<{ c: number }>(`SELECT COALESCE(SUM(delta),0) AS c FROM pass_credit_ledger WHERE pass_id = ?`, passId)!.c;
    assert.equal(creditsAfterUse, passProduct.credits - 1);
    // 4. membership booking
    const memCustomer = upsertCustomer({ email: "memcancel@example.com", name: "Mem Cancel" });
    const memProduct = get<{ id: number }>(`SELECT id FROM products WHERE kind='membership' LIMIT 1`)!;
    run(`INSERT INTO memberships (customer_id, product_id, status, current_period_start, current_period_end, created_at, updated_at) VALUES (?,?, 'active', ?, ?, ?, ?)`,
      memCustomer, memProduct.id, nowIso(), new Date(Date.now() + 20 * 86400_000).toISOString(), nowIso(), nowIso());
    const memOutcome = await startCheckout({ email: "memcancel@example.com", name: "Mem Cancel", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000", customerId: memCustomer });
    assert.ok(memOutcome.ok, JSON.stringify(memOutcome));
    if (memOutcome.ok) await markOrderPaid(memOutcome.orderRef, { provider: "test" });

    // waitlist entry that must NOT be promoted
    const waitCustomer = upsertCustomer({ email: "waitfix@example.com", name: "Wait Fix" });
    run(`INSERT INTO waitlist_entries (occurrence_id, customer_id, status, position, created_at, updated_at) VALUES (?,?, 'waiting', 1, ?, ?)`, occ, waitCustomer, nowIso(), nowIso());

    // cancel the whole class
    const res = await cancelOccurrence(occ, "anne@yogawithanne.ie", "venue double-booked");
    assert.equal(res.notified, 4);

    // all four bookings cancelled exactly once
    assert.equal(get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE occurrence_id = ? AND status = 'cancelled'`, occ)!.c, 4);

    // pass credit returned exactly once
    const creditsAfterCancel = get<{ c: number }>(`SELECT COALESCE(SUM(delta),0) AS c FROM pass_credit_ledger WHERE pass_id = ?`, passId)!.c;
    assert.equal(creditsAfterCancel, passProduct.credits, "credit returned exactly once");

    // online order flagged for refund
    assert.equal(get<{ recovery: string }>(`SELECT recovery FROM orders WHERE ref = ?`, online.orderRef!)!.recovery, "refund_required");

    // waitlist invalidated, nobody promoted
    assert.equal(get<{ status: string }>(`SELECT status FROM waitlist_entries WHERE occurrence_id = ? AND customer_id = ?`, occ, waitCustomer)!.status, "cancelled");

    // repeat is safe: still 4 cancelled, credit not returned twice
    await cancelOccurrence(occ, "anne@yogawithanne.ie", "repeat");
    assert.equal(get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE occurrence_id = ? AND status = 'cancelled'`, occ)!.c, 4);
    assert.equal(get<{ c: number }>(`SELECT COALESCE(SUM(delta),0) AS c FROM pass_credit_ledger WHERE pass_id = ? AND reason = 'returned'`, passId)!.c, 1);

    // exactly one notification per attendee
    const emails = all<{ to_email: string }>(
      `SELECT DISTINCT to_email FROM email_log WHERE related_type = 'occurrence' AND related_id = ? AND template_key = 'class_changed'`,
      occ
    );
    assert.equal(emails.length, 4);
  });

  await step("individual pass-credit cancellation returns exactly one credit even when repeated", async () => {
    const { cancelBooking } = await import("@/lib/booking");
    const occ = mkOcc({ inDays: 10, capacity: 5 });
    const customer = upsertCustomer({ email: "singlepass@example.com", name: "Single Pass" });
    const product = get<{ id: number; credits: number }>(`SELECT id, credits FROM products WHERE kind='pass' AND eligibility='all' LIMIT 1`)!;
    const pres = run(`INSERT INTO passes (customer_id, product_id, credits_total, valid_from, expires_at, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      customer, product.id, product.credits, nowIso(), new Date(Date.now() + 30 * 86400_000).toISOString(), "active", nowIso(), nowIso());
    const passId = Number(pres.lastInsertRowid);
    run(`INSERT INTO pass_credit_ledger (pass_id, delta, reason, actor, created_at) VALUES (?, ?, 'purchase', 'system', ?)`, passId, product.credits, nowIso());
    const occRow = get<{ starts_at: string }>(`SELECT starts_at FROM class_occurrences WHERE id = ?`, occ)!;
    const q = await buildQuote({ seats: [{ occurrenceId: occ, title: "t", startsAt: occRow.starts_at, dateKey: "d", priceCents: 1200, classTypeId: 1 }], customerId: customer });
    assert.equal(q.result.totalCents, 0);
    const outcome = await startCheckout({ email: "singlepass@example.com", name: "Single Pass", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000", customerId: customer });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    if (!outcome.ok) return;
    await markOrderPaid(outcome.orderRef, { provider: "test" });
    const booking = get<{ id: number }>(`SELECT id FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, outcome.orderRef)!;
    const first = await cancelBooking(booking.id, "anne@yogawithanne.ie", "admin");
    assert.ok(first.ok && first.creditReturned);
    const returned = get<{ c: number }>(`SELECT COUNT(*) AS c FROM pass_credit_ledger WHERE pass_id = ? AND reason = 'returned'`, passId)!.c;
    assert.equal(returned, 1);
    // repeat action must not return another credit
    await cancelBooking(booking.id, "anne@yogawithanne.ie", "admin");
    assert.equal(get<{ c: number }>(`SELECT COUNT(*) AS c FROM pass_credit_ledger WHERE pass_id = ? AND reason = 'returned'`, passId)!.c, 1);
  });

  // ---------- #8 refund ledger ----------
  await step("refunds: €12 → €5 partial → €7 full → further refund rejected", async () => {
    const paymentRes = run(`INSERT INTO payments (order_id, provider, provider_ref, amount_cents, status, method, created_at, updated_at) VALUES (NULL, 'stripe', 'pi_refund_test', 1200, 'succeeded', NULL, ?, ?)`, nowIso(), nowIso());
    const paymentId = Number(paymentRes.lastInsertRowid);
    const r1 = recordRefund(paymentId, 500, "anne@yogawithanne.ie", "goodwill");
    assert.ok(r1.ok && r1.status === "refunded_part" && r1.remainingCents === 700);
    assert.equal(get<{ status: string }>(`SELECT status FROM payments WHERE id = ?`, paymentId)!.status, "refunded_part");
    const r2 = recordRefund(paymentId, 700, "anne@yogawithanne.ie", "remainder");
    assert.ok(r2.ok && r2.status === "refunded" && r2.remainingCents === 0);
    assert.equal(get<{ status: string }>(`SELECT status FROM payments WHERE id = ?`, paymentId)!.status, "refunded");
    const r3 = recordRefund(paymentId, 100, "anne@yogawithanne.ie", "should fail");
    assert.equal(r3.ok, false);
    if (!r3.ok) assert.match(r3.error, /refunded|remains refundable/);
    const zero = recordRefund(paymentId, 0, "anne@yogawithanne.ie", "zero");
    assert.equal(zero.ok, false);
    assert.equal(remainingRefundable(paymentId), 0);
  });

  // ---------- #16 coupon final-redemption concurrency ----------
  await step("coupon final redemption: concurrent checkouts cannot exceed max", async () => {
    run(`INSERT INTO coupons (code, kind, value, max_redemptions, active) VALUES ('LASTONE', 'percent', 10, 1, 1)`);
    const occ = mkOcc({ inDays: 11, capacity: 5 });
    const attempts = await Promise.all([
      startCheckout({ email: "c1@example.com", name: "C1", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000", couponCode: "LASTONE" }),
      startCheckout({ email: "c2@example.com", name: "C2", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000", couponCode: "LASTONE" }),
    ]);
    const winners = attempts.filter((a) => a.ok);
    assert.equal(winners.length, 1, "exactly one checkout may claim the final redemption");
    assert.equal(get<{ t: number }>(`SELECT times_redeemed AS t FROM coupons WHERE code = 'LASTONE'`)!.t, 1);
    // expiring the winner releases the reservation
    const winner = winners[0]!;
    run(`UPDATE orders SET expires_at = ? WHERE ref = ?`, new Date(Date.now() - 1000).toISOString(), winner.orderRef!);
    run(`UPDATE capacity_holds SET expires_at = ? WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, new Date(Date.now() - 1000).toISOString(), winner.orderRef!);
    releaseExpiredHolds();
    assert.equal(get<{ t: number }>(`SELECT times_redeemed AS t FROM coupons WHERE code = 'LASTONE'`)!.t, 0);
    // now another customer can use it
    const retry = await startCheckout({ email: "c3@example.com", name: "C3", occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000", couponCode: "LASTONE" });
    assert.ok(retry.ok, JSON.stringify(retry));
  });

  // ---------- #14 two class types → correct what-to-bring ----------
  await step("confirmation email uses each booked class's own what-to-bring guidance", async () => {
    const typeB = run(`INSERT INTO class_types (name, slug, description, what_to_bring, duration_minutes) VALUES ('Restorative Special', 'restorative-special', 'd', 'Two cushions and a blanket', 60)`);
    const typeBId = Number(typeB.lastInsertRowid);
    const occA = mkOcc({ inDays: 12, capacity: 5 });
    const occB = mkOcc({ inDays: 13, capacity: 5, classTypeId: typeBId });
    const outcome = await startCheckout({ email: "twotypes@example.com", name: "Two Types", occurrenceIds: [occA, occB], marketingConsent: false, acceptTerms: true, phone: "087 555 0000" });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    if (!outcome.ok) return;
    await markOrderPaid(outcome.orderRef, { provider: "test" });
    await sendOrderConfirmation(outcome.orderRef, "Europe/Dublin");
    const email = get<{ html: string; text: string }>(
      `SELECT html, text FROM email_log WHERE to_email = 'twotypes@example.com' AND template_key = 'booking_confirmation' AND html IS NOT NULL ORDER BY id DESC LIMIT 1`
    )!;
    assert.ok(email.html.includes("Two cushions and a blanket"), "email must include class B guidance");
    const defaultGuidance = get<{ what_to_bring: string }>(`SELECT what_to_bring FROM class_types WHERE slug = 'gentle-yoga-meditation'`)!.what_to_bring!;
    assert.ok(email.html.includes(defaultGuidance), "email must include class A guidance");
  });

  // ---------- #15 escaping ----------
  await step("email variables are HTML-escaped; only _html fragments render raw", async () => {
    const trickyName = 'Eve <img src=x onerror=alert(1)> & "friends"';
    const occ = mkOcc({ inDays: 14, capacity: 5 });
    const outcome = await startCheckout({ email: "escape@example.com", name: trickyName, occurrenceIds: [occ], marketingConsent: false, acceptTerms: true, phone: "087 555 0000" });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    if (!outcome.ok) return;
    await markOrderPaid(outcome.orderRef, { provider: "test" });
    await sendOrderConfirmation(outcome.orderRef, "Europe/Dublin");
    const email = get<{ html: string }>(
      `SELECT html FROM email_log WHERE to_email = 'escape@example.com' AND template_key = 'booking_confirmation' AND html IS NOT NULL ORDER BY id DESC LIMIT 1`
    )!;
    assert.ok(!email.html.includes("<img src=x"), "raw HTML in a text variable must be escaped");
    assert.ok(email.html.includes(escapeHtml(trickyName)), "escaped name present");
    // the intentional HTML fragment still renders (e.g. <strong> around the class title)
    assert.ok(email.html.includes("<strong>Fixpass class</strong>") || email.html.includes("<p style="), "generated _html fragment stays raw");
  });

  // ---------- #10 owner data propagation ----------
  await step("owner phone change propagates to contact page; schedule summary derives from series", async () => {
    const { setSetting } = await import("@/lib/settings");
    const original = "087 763 9701";
    await setSetting("contact_phone_display", "086 555 9999");
    const html = await (await fetch(`${BASE}/contact`)).text();
    assert.ok(html.includes("086 555 9999"), "contact page must use the owner-edited phone");
    assert.ok(!html.includes(original), "stale phone must not remain");
    await setSetting("contact_phone_display", original);
    const restored = await (await fetch(`${BASE}/contact`)).text();
    assert.ok(restored.includes(original));

    // weekly schedule summary derives from active series (Tue/Thu 19:30-20:30 seeded)
    const summary = await getWeeklyScheduleSummary();
    assert.match(summary, /Tuesdays,? & Thursdays|Tuesdays & Thursdays/);
    assert.match(summary, /7\.30–8\.30 pm/);
  });

  // ---------- #17 manual recorded payment ----------
  await step("manual 'recorded' payment creates a full order + payment ledger entry", async () => {
    const occ = mkOcc({ inDays: 15, capacity: 5 });
    const res = await adminCreateBooking({ occurrenceId: occ, email: "recorded@example.com", name: "Recorded", paymentMethod: "recorded", amountCents: 1200, actor: "anne" });
    assert.ok(res.ok, JSON.stringify(res));
    const booking = get<{ order_id: number | null }>(`SELECT order_id FROM bookings WHERE id = ?`, res.bookingId!)!;
    assert.ok(booking.order_id, "recorded booking must have an order");
    const payment = get<{ method: string; status: string; amount_cents: number }>(`SELECT method, status, amount_cents FROM payments WHERE order_id = ?`, booking.order_id!)!;
    assert.equal(payment.method, "recorded");
    assert.equal(payment.status, "succeeded");
    assert.equal(payment.amount_cents, 1200);
  });

  // ---------- weekly schedule summary edge ----------
  await step("schedule summary is empty when no active series exist", async () => {
    run(`UPDATE class_series SET status = 'retired'`);
    assert.equal(await getWeeklyScheduleSummary(), "");
    run(`UPDATE class_series SET status = 'active'`);
    run(`UPDATE class_series SET publication_status = 'draft'`);
    assert.equal(await getWeeklyScheduleSummary(), "");
    run(`UPDATE class_series SET publication_status = 'published'`);
    assert.ok((await getWeeklyScheduleSummary()).length > 0);
  });

  await step("draft blocks and bundles stay out of public lists and booking", async () => {
    const { listActiveBlockViews, listActiveBundleViews } = await import("@/lib/blocks");
    const { generateOccurrences } = await import("@/lib/tz");
    const settings = await import("@/lib/settings").then((module) => module.getSettings());
    const series = get<{ id: number; weekdays: string; start_time: string; end_time: string; class_type_id: number; venue_id: number | null; instructor_id: number | null; capacity: number }>(
      `SELECT id, weekdays, start_time, end_time, class_type_id, venue_id, instructor_id, capacity FROM class_series WHERE status = 'active' AND publication_status = 'published' LIMIT 1`
    )!;
    const weekday = (JSON.parse(series.weekdays) as number[])[0];
    const fromDate = new Date(Date.now() + 300 * 86400_000).toISOString().slice(0, 10);
    const toDate = new Date(Date.now() + 315 * 86400_000).toISOString().slice(0, 10);
    const dates = generateOccurrences({
      weekdays: [weekday], startTime: series.start_time, endTime: series.end_time,
      fromDate, toDate, tz: settings.timezone,
    });
    assert.ok(dates.length >= 2);
    for (const date of dates) {
      run(
        `INSERT OR IGNORE INTO class_occurrences (series_id, class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, publication_status, source)
         VALUES (?,?,?,?,?,?,?,?,'published','series')`,
        series.id, series.class_type_id, series.venue_id, series.instructor_id, "Publication test block", date.startsAt, date.endsAt, series.capacity
      );
    }
    const draftBlockId = Number(run(
      `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, publication_status)
       VALUES (?,?,?,?,?,?, 'draft')`,
      series.id, "Hidden draft block", dates[0].dateKey, dates[1].dateKey, 4000, JSON.stringify([weekday])
    ).lastInsertRowid);
    assert.equal((await listActiveBlockViews()).some((block) => block.id === draftBlockId), false);

    const blockQuote = await fetch(`${BASE}/api/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blockId: draftBlockId }),
    });
    assert.equal(blockQuote.status, 404);
    const blockCheckout = await startCheckout({
      email: "draft-block@example.com", name: "Draft Block", occurrenceIds: [],
      marketingConsent: false, acceptTerms: true, phone: "087 555 6200", blockId: draftBlockId,
    });
    assert.equal(blockCheckout.ok, false);

    const privateSeriesId = Number(run(
      `INSERT INTO class_series (title, class_type_id, venue_id, instructor_id, weekdays, start_time, end_time, capacity, publication_status)
       VALUES (?,?,?,?,?,'19:30','20:30',?,'draft')`,
      "Block-only schedule", series.class_type_id, series.venue_id, series.instructor_id, JSON.stringify([weekday]), series.capacity
    ).lastInsertRowid);
    const privateOccurrenceIds = dates.slice(0, 2).map((date) => Number(run(
      `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, publication_status, source)
       VALUES (?,?,?,?,?,?,?,?, 'draft','series')`,
      privateSeriesId, series.class_type_id, series.venue_id, series.instructor_id, "Block-only class", date.startsAt, date.endsAt, series.capacity
    ).lastInsertRowid));
    const blockOnlyId = Number(run(
      `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, publication_status)
       VALUES (?,?,?,?,?,?, 'published')`,
      privateSeriesId, "Block-only offering", dates[0].dateKey, dates[1].dateKey, 5500, JSON.stringify([weekday])
    ).lastInsertRowid);
    assert.ok((await listActiveBlockViews()).some((block) => block.id === blockOnlyId));
    assert.equal(await getOccurrenceView(privateOccurrenceIds[0]), null, "block-only dates must remain hidden from drop-in browsing");
    const blockOnlyQuote = await fetch(`${BASE}/api/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blockId: blockOnlyId }),
    });
    assert.equal(blockOnlyQuote.status, 200);
    const blockOnlyCheckout = await startCheckout({
      email: "block-only@example.com", name: "Block Only", occurrenceIds: [],
      marketingConsent: false, acceptTerms: true, phone: "087 555 6211", blockId: blockOnlyId,
    });
    assert.equal(blockOnlyCheckout.ok, true, "whole-block bookings should work while individual dates stay unpublished");

    const publishedBlockId = Number(run(
      `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, publication_status)
       VALUES (?,?,?,?,?,?, 'published')`,
      series.id, "Published block for draft bundle", dates[0].dateKey, dates[1].dateKey, 5000, JSON.stringify([weekday])
    ).lastInsertRowid);
    const bundleId = Number(run(
      `INSERT INTO block_bundles (name, price_cents, active, publication_status) VALUES ('Hidden draft bundle', 8000, 1, 'draft')`
    ).lastInsertRowid);
    run(`INSERT INTO block_bundle_items (bundle_id, block_id, sort) VALUES (?,?,0)`, bundleId, draftBlockId);
    run(`INSERT INTO block_bundle_items (bundle_id, block_id, sort) VALUES (?,?,1)`, bundleId, publishedBlockId);
    assert.equal((await listActiveBundleViews()).some((bundle) => bundle.id === bundleId), false);
    const bundleQuote = await fetch(`${BASE}/api/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bundleId }),
    });
    assert.equal(bundleQuote.status, 404);
  });

  const createPublishedBlock = async (name: string, weekday: number, daysAhead: number, capacity: number) => {
    const settings = await import("@/lib/settings").then((module) => module.getSettings());
    const typeId = get<{ id: number }>(`SELECT id FROM class_types LIMIT 1`)!.id;
    const venueId = get<{ id: number }>(`SELECT id FROM venues LIMIT 1`)!.id;
    const dateFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const startDay = new Date(Date.now() + daysAhead * 86400_000);
    while (((startDay.getUTCDay() || 7) !== weekday)) startDay.setUTCDate(startDay.getUTCDate() + 1);
    const startDate = dateFormatter.format(startDay);
    const endDay = new Date(startDay);
    endDay.setUTCDate(endDay.getUTCDate() + 7);
    const endDate = dateFormatter.format(endDay);
    const seriesId = Number(run(
      `INSERT INTO class_series (title, class_type_id, venue_id, weekdays, start_time, end_time, capacity, publication_status)
       VALUES (?,?,?,?, '19:30','20:30',?,'published')`,
      name, typeId, venueId, JSON.stringify([weekday]), capacity
    ).lastInsertRowid);
    const slots = generateOccurrences({
      weekdays: [weekday], startTime: "19:30", endTime: "20:30", fromDate: startDate, toDate: endDate, tz: settings.timezone,
    });
    assert.equal(slots.length, 2);
    const occurrenceIds = slots.map((slot) => Number(run(
      `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, title, starts_at, ends_at, capacity, publication_status)
       VALUES (?,?,?,?,?,?,?,'published')`,
      seriesId, typeId, venueId, name, slot.startsAt, slot.endsAt, capacity
    ).lastInsertRowid));
    const blockId = Number(run(
      `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, publication_status)
       VALUES (?,?,?,?,?,?, 'published')`,
      seriesId, name, startDate, endDate, 6000, JSON.stringify([weekday])
    ).lastInsertRowid);
    return { blockId, occurrenceIds };
  };

  await step("teacher can manually enroll a student in every date of a block and record offline payment", async () => {
    const block = await createPublishedBlock("Manual block enrollment", 1, 230, 4);
    const result = await adminCreateBlockBooking({
      blockId: block.blockId, email: "manual-block@example.com", name: "Manual Block", phone: "087 555 6300",
      paymentMethod: "cash", actor: "test",
    });
    assert.ok(result.ok, result.error);
    assert.equal(result.bookingCount, 2);
    const bookings = all<{ order_id: number; price_cents: number; occurrence_id: number }>(
      `SELECT order_id, price_cents, occurrence_id FROM bookings WHERE order_id = ? ORDER BY occurrence_id`, result.orderId!
    );
    assert.equal(bookings.length, 2);
    assert.deepEqual(bookings.map((booking) => booking.occurrence_id).sort(), block.occurrenceIds.sort());
    assert.equal(bookings.reduce((sum, booking) => sum + booking.price_cents, 0), 6000);
    assert.equal(get<{ status: string; offline: number }>(`SELECT status, offline FROM orders WHERE id = ?`, result.orderId!)!.status, "paid");
    assert.equal(get<{ method: string; amount_cents: number }>(`SELECT method, amount_cents FROM payments WHERE order_id = ?`, result.orderId!)!.method, "cash");
    assert.equal(get<{ amount_cents: number }>(`SELECT amount_cents FROM payments WHERE order_id = ?`, result.orderId!)!.amount_cents, 6000);
  });

  await step("manual bundle enrollment covers all dates of its included blocks", async () => {
    const monday = await createPublishedBlock("Manual bundle Monday", 1, 250, 4);
    const tuesday = await createPublishedBlock("Manual bundle Tuesday", 2, 250, 4);
    const bundleId = Number(run(`INSERT INTO block_bundles (name, price_cents, active, publication_status) VALUES ('Manual teacher bundle', 10000, 1, 'published')`).lastInsertRowid);
    run(`INSERT INTO block_bundle_items (bundle_id, block_id, sort) VALUES (?,?,0)`, bundleId, monday.blockId);
    run(`INSERT INTO block_bundle_items (bundle_id, block_id, sort) VALUES (?,?,1)`, bundleId, tuesday.blockId);
    const result = await adminCreateBlockBooking({
      bundleId, email: "manual-bundle@example.com", name: "Manual Bundle", paymentMethod: "transfer", actor: "test",
    });
    assert.ok(result.ok, result.error);
    assert.equal(result.bookingCount, 4);
    assert.equal(get<{ count: number }>(`SELECT COUNT(*) AS count FROM bookings WHERE order_id = ? AND status = 'confirmed'`, result.orderId!)!.count, 4);
    assert.equal(get<{ amount_cents: number; method: string }>(`SELECT amount_cents, method FROM payments WHERE order_id = ?`, result.orderId!)!.amount_cents, 10000);
    assert.equal(get<{ method: string }>(`SELECT method FROM payments WHERE order_id = ?`, result.orderId!)!.method, "transfer");
  });

  await step("manual whole-block enrollment fails atomically if any included date is full", async () => {
    const block = await createPublishedBlock("Full manual block", 3, 270, 1);
    const occupied = await adminCreateBooking({
      occurrenceId: block.occurrenceIds[0], email: "occupant@example.com", name: "Occupant", paymentMethod: "cash", actor: "test",
    });
    assert.ok(occupied.ok, occupied.error);
    const result = await adminCreateBlockBooking({
      blockId: block.blockId, email: "blocked-manual@example.com", name: "Blocked Manual", paymentMethod: "cash", actor: "test",
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /one of the dates.*full/i);
    assert.equal(get<{ count: number }>(`SELECT COUNT(*) AS count FROM bookings WHERE customer_id = (SELECT id FROM customers WHERE email = 'blocked-manual@example.com')`)!.count, 0);
    assert.equal(get<{ count: number }>(`SELECT COUNT(*) AS count FROM orders WHERE customer_id = (SELECT id FROM customers WHERE email = 'blocked-manual@example.com')`)!.count, 0);
  });

  await step("group event booking reserves people, charges per person, and stores attendee names", async () => {
    const settings = await import("@/lib/settings").then((module) => module.getSettings());
    const typeId = get<{ id: number }>(`SELECT id FROM class_types LIMIT 1`)!.id;
    const venueId = get<{ id: number }>(`SELECT id FROM venues LIMIT 1`)!.id;
    const startDay = new Date(Date.now() + 330 * 86400_000);
    const localDate = (date: Date) => new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(date);
    const startDate = localDate(startDay);
    const endDay = new Date(startDay);
    endDay.setUTCDate(endDay.getUTCDate() + 2);
    const endDate = localDate(endDay);
    const makeEvent = (name: string, daysAhead: number, capacity: number, priceCents: number) => {
      const targetStart = localDate(new Date(Date.now() + daysAhead * 86400_000));
      const targetEndDate = new Date(`${targetStart}T12:00:00Z`);
      targetEndDate.setUTCDate(targetEndDate.getUTCDate() + 1);
      const targetEnd = localDate(targetEndDate);
      const [y1, m1, d1] = targetStart.split("-").map(Number);
      const [y2, m2, d2] = targetEnd.split("-").map(Number);
      const series = Number(run(
        `INSERT INTO class_series (title, class_type_id, venue_id, weekdays, start_time, end_time, capacity, status, publication_status)
         VALUES (?, ?, ?, '[1]', '00:00', '23:59', ?, 'retired', 'published')`, name, typeId, venueId, capacity
      ).lastInsertRowid);
      const occurrence = Number(run(
        `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, title, starts_at, ends_at, capacity, publication_status)
         VALUES (?,?,?,?,?,?,?,'published')`, series, typeId, venueId, name,
        zonedToUtc(y1, m1, d1, 0, 0, settings.timezone), zonedToUtc(y2, m2, d2, 23, 59, settings.timezone), capacity
      ).lastInsertRowid);
      const block = Number(run(
        `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, kind, publication_status)
         VALUES (?,?,?,?,?, '[1]', 'retreat', 'published')`, series, name, targetStart, targetEnd, priceCents
      ).lastInsertRowid);
      return { occurrenceId: occurrence, blockId: block };
    };
    const [sy, sm, sd] = startDate.split("-").map(Number);
    const [ey, em, ed] = endDate.split("-").map(Number);
    const seriesId = Number(run(
      `INSERT INTO class_series (title, class_type_id, venue_id, weekdays, start_time, end_time, capacity, status, publication_status)
       VALUES ('Group retreat inventory', ?, ?, '[1]', '00:00', '23:59', 3, 'retired', 'published')`, typeId, venueId
    ).lastInsertRowid);
    const eventOccurrenceId = Number(run(
      `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, title, starts_at, ends_at, capacity, publication_status)
       VALUES (?,?,?,?,?,?,3,'published')`,
      seriesId, typeId, venueId, "Weekend Yoga Retreat",
      zonedToUtc(sy, sm, sd, 0, 0, settings.timezone), zonedToUtc(ey, em, ed, 23, 59, settings.timezone)
    ).lastInsertRowid);
    const eventId = Number(run(
      `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, kind, description, daily_times_json, publication_status)
       VALUES (?,?,?,?,?, '[1]', 'retreat', 'A three-day retreat', ?, 'published')`,
      seriesId, "Weekend Yoga Retreat", startDate, endDate, 4500,
      JSON.stringify({ mode: "daily", days: [
        { date: startDate, start: "09:00", end: "16:00" },
        { date: localDate(new Date(Date.parse(`${startDate}T12:00:00Z`) + 86400_000)), start: "10:00", end: "17:00" },
        { date: endDate, start: "08:30", end: "15:30" },
      ] })
    ).lastInsertRowid);

    const quoteResponse = await fetch(`${BASE}/api/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockId: eventId, attendeeCount: 2 }),
    });
    const quote = await quoteResponse.json() as { result: { totalCents: number; lines: { qty: number }[] }; blockMode: { kind: string; rangeLabel: string } };
    assert.equal(quote.result.totalCents, 9000);
    assert.equal(quote.result.lines[0].qty, 2);
    assert.equal(quote.blockMode.kind, "retreat");
    assert.match(quote.blockMode.rangeLabel, /–/);

    run(`UPDATE class_blocks SET early_bird_price_cents = 3500, early_bird_until = '2999-01-01' WHERE id = ?`, eventId);
    const ebQuote = await (await fetch(`${BASE}/api/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockId: eventId, attendeeCount: 2 }),
    })).json() as { result: { totalCents: number } };
    assert.equal(ebQuote.result.totalCents, 7000, "early bird price should apply to the quote");
    run(`UPDATE class_blocks SET early_bird_price_cents = NULL, early_bird_until = NULL WHERE id = ?`, eventId);

    const checkout = await startCheckout({
      email: "group-payer@example.com", name: "Group Payer", phone: "087 555 6500", occurrenceIds: [],
      marketingConsent: false, acceptTerms: true, blockId: eventId, attendeeNames: ["Group Payer", "Second Guest"],
    });
    assert.ok(checkout.ok, JSON.stringify(checkout));
    const hold = get<{ qty: number }>(`SELECT qty FROM capacity_holds WHERE order_id = ?`, checkout.orderId!)!;
    assert.equal(hold.qty, 2);

    const oversize = await startCheckout({
      email: "second-group@example.com", name: "Second Group", phone: "087 555 6501", occurrenceIds: [],
      marketingConsent: false, acceptTerms: true, blockId: eventId, attendeeNames: ["Second Group", "Extra Guest"],
    });
    assert.equal(oversize.ok, false);

    const paid = await markOrderPaid(checkout.orderRef!, { provider: "test", providerRef: `test-${checkout.orderRef}` });
    assert.ok(paid.ok);
    assert.equal(get<{ seat_count: number }>(`SELECT seat_count FROM bookings WHERE occurrence_id = ? AND customer_id = (SELECT id FROM customers WHERE email = 'group-payer@example.com')`, eventOccurrenceId)!.seat_count, 2);
    assert.deepEqual(
      all<{ name: string }>(`SELECT name FROM booking_attendees WHERE booking_id = (SELECT id FROM bookings WHERE occurrence_id = ? AND customer_id = (SELECT id FROM customers WHERE email = 'group-payer@example.com')) ORDER BY sort`, eventOccurrenceId).map((row) => row.name),
      ["Group Payer", "Second Guest"]
    );
    const confirmation = get<{ html: string }>(
      `SELECT html FROM email_log WHERE to_email = 'group-payer@example.com' AND template_key = 'booking_confirmation' ORDER BY id DESC LIMIT 1`
    )!;
    assert.ok(confirmation.html.includes("Group Payer") && confirmation.html.includes("Second Guest"));
    assert.ok(confirmation.html.includes("Weekend Yoga Retreat"));
    const eventPage = await (await fetch(`${BASE}/classes/${eventOccurrenceId}`)).text();
    const eventText = eventPage.replace(/<!-- -->/g, "");
    assert.ok(eventText.includes("Daily retreat times"), "event details should include the daily schedule heading");
    assert.ok(eventText.includes("9:00 AM to 4:00 PM"), "first day's retreat hours should render");
    assert.ok(eventText.includes("10:00 AM to 5:00 PM"), "second day's retreat hours should render");
    assert.ok(eventText.includes("8:30 AM to 3:30 PM"), "third day's retreat hours should render");

    await cancelOccurrence(eventOccurrenceId, "test", "Replacement needed");
    const undersizedEvent = makeEvent("Undersized replacement retreat", 380, 1, 3500);
    const paidBookingId = get<{ id: number }>(`SELECT id FROM bookings WHERE order_id = ?`, checkout.orderId!)!.id;
    const capacityRejected = transferEventBooking({
      bookingId: paidBookingId, targetOccurrenceId: undersizedEvent.occurrenceId,
      attendeeNames: ["Group Payer", "Second Guest"], actor: "test",
    });
    assert.equal(capacityRejected.ok, false);
    assert.match(capacityRejected.error ?? "", /enough places/i);
    assert.equal(get<{ status: string }>(`SELECT status FROM bookings WHERE id = ?`, paidBookingId)!.status, "cancelled");
    const lowerPriceEvent = makeEvent("Lower-price replacement retreat", 390, 4, 3500);
    const lowerTransfer = transferEventBooking({
      bookingId: paidBookingId,
      targetOccurrenceId: lowerPriceEvent.occurrenceId,
      attendeeNames: ["Group Payer Updated", "Second Guest"],
      actor: "test",
    });
    assert.ok(lowerTransfer.ok, lowerTransfer.ok ? "" : lowerTransfer.error);
    assert.equal(lowerTransfer.refundDueCents, 2000);
    assert.equal(get<{ occurrence_id: number; status: string; order_id: number }>(`SELECT occurrence_id, status, order_id FROM bookings WHERE id = ?`, paidBookingId)!.occurrence_id, lowerPriceEvent.occurrenceId);
    assert.equal(get<{ order_id: number }>(`SELECT order_id FROM bookings WHERE id = ?`, paidBookingId)!.order_id, checkout.orderId);
    assert.equal(get<{ recovery: string | null }>(`SELECT recovery FROM orders WHERE id = ?`, checkout.orderId!)!.recovery, null);
    assert.deepEqual(all<{ name: string }>(`SELECT name FROM booking_attendees WHERE booking_id = ? ORDER BY sort`, paidBookingId).map((row) => row.name), ["Group Payer Updated", "Second Guest"]);
    const originalPaymentId = get<{ id: number }>(`SELECT id FROM payments WHERE order_id = ? AND status = 'succeeded'`, checkout.orderId!)!.id;
    const excessiveRefund = recordRefund(originalPaymentId, lowerTransfer.refundDueCents + 1, "test", "Excess refund", {
      provider: "test", providerRef: `transfer-overrefund-${lowerTransfer.transferId}`, eventTransferId: lowerTransfer.transferId,
    });
    assert.equal(excessiveRefund.ok, false);
    const refund = recordRefund(originalPaymentId, lowerTransfer.refundDueCents, "test", "Replacement event price difference", {
      provider: "test", providerRef: `transfer-refund-${lowerTransfer.transferId}`, eventTransferId: lowerTransfer.transferId,
    });
    assert.ok(refund.ok, refund.ok ? "" : refund.error);
    assert.equal(get<{ settlement_status: string; refund_due_cents: number }>(`SELECT settlement_status, refund_due_cents FROM event_transfers WHERE id = ?`, lowerTransfer.transferId)!.settlement_status, "settled");

    const manualStartDay = new Date(Date.now() + 350 * 86400_000);
    const manualStartDate = localDate(manualStartDay);
    const manualEndDay = new Date(manualStartDay);
    manualEndDay.setUTCDate(manualEndDay.getUTCDate() + 1);
    const manualEndDate = localDate(manualEndDay);
    const [msy, msm, msd] = manualStartDate.split("-").map(Number);
    const [mey, mem, med] = manualEndDate.split("-").map(Number);
    const manualSeriesId = Number(run(
      `INSERT INTO class_series (title, class_type_id, venue_id, weekdays, start_time, end_time, capacity, status, publication_status)
       VALUES ('Manual group retreat inventory', ?, ?, '[1]', '00:00', '23:59', 3, 'retired', 'published')`, typeId, venueId
    ).lastInsertRowid);
    const manualOccurrenceId = Number(run(
      `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, title, starts_at, ends_at, capacity, publication_status)
       VALUES (?,?,?,?,?,?,3,'published')`,
      manualSeriesId, typeId, venueId, "Manual Retreat",
      zonedToUtc(msy, msm, msd, 0, 0, settings.timezone), zonedToUtc(mey, mem, med, 23, 59, settings.timezone)
    ).lastInsertRowid);
    const manualEventId = Number(run(
      `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, kind, publication_status)
       VALUES (?,?,?,?,?, '[1]', 'retreat', 'published')`,
      manualSeriesId, "Manual Retreat", manualStartDate, manualEndDate, 4500
    ).lastInsertRowid);
    const manual = await adminCreateBlockBooking({
      blockId: manualEventId, email: "manual-retreat-payer@example.com", name: "Manual Retreat Payer",
      attendeeNames: ["Manual Retreat Payer", "Manual Retreat Friend"], paymentMethod: "cash", actor: "test",
    });
    assert.ok(manual.ok, manual.error);
    assert.equal(get<{ seat_count: number }>(`SELECT seat_count FROM bookings WHERE occurrence_id = ? AND order_id = ?`, manualOccurrenceId, manual.orderId!)!.seat_count, 2);
    assert.deepEqual(
      all<{ name: string }>(`SELECT name FROM booking_attendees WHERE booking_id = (SELECT id FROM bookings WHERE order_id = ?) ORDER BY sort`, manual.orderId!).map((row) => row.name),
      ["Manual Retreat Payer", "Manual Retreat Friend"]
    );
    const tooMany = await adminCreateBlockBooking({
      blockId: manualEventId, email: "manual-retreat-extra@example.com", name: "Manual Extra",
      attendeeNames: ["Manual Extra", "Friend 1"], paymentMethod: "cash", actor: "test",
    });
    assert.equal(tooMany.ok, false);
    assert.match(tooMany.error ?? "", /one of the dates.*full/i);

    await cancelOccurrence(manualOccurrenceId, "test", "Replacement needed");
    const higherPriceEvent = makeEvent("Higher-price replacement retreat", 410, 4, 5000);
    const manualBookingId = get<{ id: number }>(`SELECT id FROM bookings WHERE order_id = ?`, manual.orderId!)!.id;
    const missingSettlement = transferEventBooking({
      bookingId: manualBookingId, targetOccurrenceId: higherPriceEvent.occurrenceId,
      attendeeNames: ["Manual Retreat Payer", "Manual Retreat Friend"], actor: "test",
    });
    assert.equal(missingSettlement.ok, false);
    assert.match(missingSettlement.error ?? "", /additional/i);
    assert.equal(get<{ status: string }>(`SELECT status FROM bookings WHERE id = ?`, manualBookingId)!.status, "cancelled");
    const higherTransfer = transferEventBooking({
      bookingId: manualBookingId, targetOccurrenceId: higherPriceEvent.occurrenceId,
      attendeeNames: ["Manual Retreat Payer", "Manual Retreat Friend"], paymentMethod: "transfer", actor: "test", note: "Transfer received",
    });
    assert.ok(higherTransfer.ok, higherTransfer.ok ? "" : higherTransfer.error);
    assert.equal(higherTransfer.adjustmentPaidCents, 1000);
    const adjustment = get<{ order_id: number }>(`SELECT adjustment_order_id AS order_id FROM event_transfers WHERE id = ?`, higherTransfer.transferId)!;
    assert.equal(get<{ amount_cents: number; method: string }>(`SELECT amount_cents, method FROM payments WHERE order_id = ?`, adjustment.order_id)!.amount_cents, 1000);
    assert.equal(get<{ method: string }>(`SELECT method FROM payments WHERE order_id = ?`, adjustment.order_id)!.method, "transfer");
  });

  // ---------- Phase 2: blocks & bundles ----------
  await step("block lifecycle: create → quote → checkout → one payment books every date", async () => {
    const { getBlockView } = await import("@/lib/blocks");
    const { run: r2 } = await import("@/db");
    // series of Tue/Thu 19:30 exists from seed; make a 4-week block
    const series = get<{ id: number }>(`SELECT id FROM class_series WHERE status = 'active' LIMIT 1`)!;
    const from = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + (14 + 4 * 7 - 1) * 86400_000).toISOString().slice(0, 10);
    const res = r2(`INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, active) VALUES (?,?,?,?,?,1)`,
      series.id, "Autumn Block - integration", from, end, 8000);
    const blockId = Number(res.lastInsertRowid);

    const view = await getBlockView(blockId);
    assert.ok(view, "block view loads");
    assert.equal(view!.classCount, 8, "Tue+Thu over 4 weeks = 8 dates");
    assert.equal(view!.onSale, true);

    // HTTP quote for the block
    const quote = await (await fetch(`${BASE}/api/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockId }),
    })).json();
    assert.equal(quote.result.totalCents, 8000);
    assert.equal(quote.blockMode.classCount, 8);

    // checkout: ONE payment books all 8 dates
    let outcome;
    try {
      outcome = await startCheckout({
        email: "blockbuyer@example.com", name: "Block Buyer", occurrenceIds: [],
        marketingConsent: false, acceptTerms: true, phone: "087 555 2001", blockId,
      });
    } catch (e) {
      console.error("BLOCK CHECKOUT STACK:", (e as Error).stack);
      throw e;
    }
    assert.ok(outcome.ok, JSON.stringify(outcome));
    const paid = await markOrderPaid(outcome.orderRef!, { provider: "test", providerRef: `test-${outcome.orderRef}` });
    assert.ok(paid.ok);
    const bookings = get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?) AND status = 'confirmed'`, outcome.orderRef!)!.c;
    assert.equal(bookings, 8);
    // per-seat price shares sum to the block price
    const seatSum = get<{ s: number }>(`SELECT SUM(price_cents) AS s FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, outcome.orderRef!)!.s;
    assert.equal(seatSum, 8000);

    // duplicate: second attempt for the same customer is refused
    const dup = await startCheckout({
      email: "blockbuyer@example.com", name: "Block Buyer", occurrenceIds: [],
      marketingConsent: false, acceptTerms: true, phone: "087 555 2001", blockId,
    });
    assert.equal(dup.ok, false);

    // non-refundable: customer cancel is blocked
    const { cancelBooking } = await import("@/lib/booking");
    const booking = get<{ id: number }>(`SELECT id FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?) LIMIT 1`, outcome.orderRef!)!;
    const attempt = await cancelBooking(booking.id, "blockbuyer@example.com", "customer");
    assert.equal(attempt.ok, false);
    if (!attempt.ok) assert.match(attempt.message, /non-refundable/i);

    // re-advertise: move start forward + drop price - earlier buyers untouched
    const newFrom = new Date(Date.now() + 28 * 86400_000).toISOString().slice(0, 10);
    r2(`UPDATE class_blocks SET start_date = ?, price_cents = 6000 WHERE id = ?`, newFrom, blockId);
    const later = await getBlockView(blockId);
    assert.ok(later!.classCount < 8, "shortened block has fewer dates");
    assert.equal(get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?) AND status='confirmed'`, outcome.orderRef!)!.c, 8, "original buyer keeps all 8 bookings");
    const quote2 = await (await fetch(`${BASE}/api/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blockId }),
    })).json();
    assert.equal(quote2.result.totalCents, 6000, "re-advertised price shown to new buyers");
  });

  await step("bundle: one payment books every date of both blocks", async () => {
    const { run: r2 } = await import("@/db");
    const { zonedToUtc } = await import("@/lib/tz");
    const mkSeries = (name: string, weekday: number) => {
      const res = r2(`INSERT INTO class_series (title, class_type_id, venue_id, instructor_id, weekdays, start_time, end_time, capacity, waitlist_enabled) VALUES (?,?,?,?,?,?,?,?,1)`,
        name, (get<{ id: number }>(`SELECT id FROM class_types LIMIT 1`)!.id), (get<{ id: number }>(`SELECT id FROM venues LIMIT 1`)!.id), null,
        JSON.stringify([weekday]), "19:30", "20:30", 10);
      const seriesId = Number(res.lastInsertRowid);
      // generate 3 weeks of occurrences
      const from = new Date(Date.now() + 21 * 86400_000);
      for (let w = 0; w < 3; w++) {
        const day = new Date(from.getTime() + w * 7 * 86400_000);
        // nudge day to the target weekday
        while ((day.getUTCDay() === 0 ? 7 : day.getUTCDay()) !== weekday) day.setUTCDate(day.getUTCDate() + 1);
        const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
        const [y, m, dd] = local.split("-").map(Number);
        const startsAt = zonedToUtc(y, m, dd, 19, 30, "Europe/Dublin");
        const endsAt = zonedToUtc(y, m, dd, 20, 30, "Europe/Dublin");
        r2(`INSERT OR IGNORE INTO class_occurrences (series_id, class_type_id, venue_id, title, starts_at, ends_at, capacity, waitlist_enabled, source) VALUES (?,?,?,?,?,?,10,1,'series')`,
          seriesId, (get<{ id: number }>(`SELECT id FROM class_types LIMIT 1`)!.id), (get<{ id: number }>(`SELECT id FROM venues LIMIT 1`)!.id), name, startsAt, endsAt);
      }
      return seriesId;
    };
    const tueSeries = mkSeries("Tuesdays - bundle test", 2);
    const thuSeries = mkSeries("Thursdays - bundle test", 4);
    const from = new Date(Date.now() + 21 * 86400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 42 * 86400_000).toISOString().slice(0, 10);
    const b1 = Number(r2(`INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, active) VALUES (?,?,?,?,?,?,1)`,
      tueSeries, "Tue block", from, end, 4500, JSON.stringify([2])).lastInsertRowid);
    const b2 = Number(r2(`INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, active) VALUES (?,?,?,?,?,?,1)`,
      thuSeries, "Thu block", from, end, 4500, JSON.stringify([4])).lastInsertRowid);
    const bundleId = Number(r2(`INSERT INTO block_bundles (name, price_cents, active) VALUES ('Full programme', 8000, 1)`).lastInsertRowid);
    r2(`INSERT INTO block_bundle_items (bundle_id, block_id, sort) VALUES (?,?,0)`, bundleId, b1);
    r2(`INSERT INTO block_bundle_items (bundle_id, block_id, sort) VALUES (?,?,1)`, bundleId, b2);

    const quote = await (await fetch(`${BASE}/api/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bundleId }),
    })).json();
    assert.equal(quote.result.totalCents, 8000);
    assert.equal(quote.blockMode.classCount, 6, "3 Tuesdays + 3 Thursdays = 6 classes");

    const outcome = await startCheckout({
      email: "bundlebuyer@example.com", name: "Bundle Buyer", occurrenceIds: [],
      marketingConsent: false, acceptTerms: true, phone: "087 555 2002", bundleId,
    });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    await markOrderPaid(outcome.orderRef!, { provider: "test", providerRef: `test-${outcome.orderRef}` });
    const bookings = get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?) AND status = 'confirmed'`, outcome.orderRef!)!.c;
    assert.equal(bookings, 6);
    const seatSum = get<{ s: number }>(`SELECT SUM(price_cents) AS s FROM bookings WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, outcome.orderRef!)!.s;
    assert.equal(seatSum, 8000);
  });

  await step("last-seat race inside a block: concurrent buyers cannot oversell", async () => {
    const { run: r2 } = await import("@/db");
    const { zonedToUtc } = await import("@/lib/tz");
    const day = new Date(Date.now() + 35 * 86400_000);
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
    const [y, m, dd] = local.split("-").map(Number);
    const startsAt = zonedToUtc(y, m, dd, 19, 30, "Europe/Dublin");
    const endsAt = zonedToUtc(y, m, dd, 20, 30, "Europe/Dublin");
    const weekday = new Date(`${local}T12:00:00Z`).getUTCDay() || 7;
    const typeId = get<{ id: number }>(`SELECT id FROM class_types LIMIT 1`)!.id;
    const venueId = get<{ id: number }>(`SELECT id FROM venues LIMIT 1`)!.id;
    const series = Number(r2(
      `INSERT INTO class_series (title, class_type_id, venue_id, weekdays, start_time, end_time, capacity, waitlist_enabled)
       VALUES (?,?,?,?,?,?,1,1)`,
      "Single-capacity block race", typeId, venueId, JSON.stringify([weekday]), "19:30", "20:30"
    ).lastInsertRowid);
    r2(
      `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, title, starts_at, ends_at, capacity, waitlist_enabled, source)
       VALUES (?,?,?,?,?,?,1,1,'series')`,
      series, typeId, venueId, "Tiny block class", startsAt, endsAt
    );
    const bId = Number(r2(
      `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, active) VALUES (?,?,?,?,?,?,1)`,
      series, "Tiny block", local, local, 2000, JSON.stringify([weekday])
    ).lastInsertRowid);

    const attempts = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        startCheckout({
          email: `blockracer-${i}@example.com`, name: `Racer ${i}`, occurrenceIds: [],
          marketingConsent: false, acceptTerms: true, phone: "087 555 300" + i, blockId: bId,
        }).catch(() => ({ ok: false as const, error: "crashed" }))
      )
    );
    const wins = attempts.filter((a) => a.ok).length;
    assert.equal(wins, 1, `expected exactly 1 block-sale winner, got ${wins}: ${JSON.stringify(attempts).slice(0, 300)}`);
  });

  await step("draft individual classes are hidden and cannot be booked", async () => {
    const occurrenceId = mkOcc({ inDays: 45, capacity: 5, publicationStatus: "draft", title: "Hidden draft class" });
    assert.equal(await getOccurrenceView(occurrenceId), null);
    assert.equal((await listUpcoming(200)).some((occurrence) => occurrence.id === occurrenceId), false);

    const detail = await fetch(`${BASE}/classes/${occurrenceId}`);
    assert.equal(detail.status, 404);
    const quote = await fetch(`${BASE}/api/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ occurrenceIds: [occurrenceId] }),
    });
    assert.equal(quote.status, 404);

    const checkout = await startCheckout({
      email: "draft-class@example.com", name: "Draft Class", occurrenceIds: [occurrenceId],
      marketingConsent: false, acceptTerms: true, phone: "087 555 6100",
    });
    assert.equal(checkout.ok, false);
    const manual = await adminCreateBooking({
      occurrenceId, email: "draft-manual@example.com", name: "Draft Manual", paymentMethod: "cash", actor: "test",
    });
    assert.equal(manual.ok, false);
  });

  await step("draft series hide their generated dates even if an occurrence is marked published", async () => {
    const typeId = get<{ id: number }>(`SELECT id FROM class_types LIMIT 1`)!.id;
    const venueId = get<{ id: number }>(`SELECT id FROM venues LIMIT 1`)!.id;
    const seriesId = Number(run(
      `INSERT INTO class_series (title, class_type_id, venue_id, weekdays, start_time, end_time, publication_status)
       VALUES ('Hidden draft series', ?, ?, '[2]', '19:30', '20:30', 'draft')`, typeId, venueId
    ).lastInsertRowid);
    const startsAt = new Date(Date.now() + 46 * 86400_000).toISOString();
    const occurrenceId = Number(run(
      `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, title, starts_at, ends_at, publication_status)
       VALUES (?, ?, ?, 'Published child of draft series', ?, ?, 'published')`,
      seriesId, typeId, venueId, startsAt, new Date(Date.now() + 46 * 86400_000 + 3600_000).toISOString()
    ).lastInsertRowid);

    assert.equal(await getOccurrenceView(occurrenceId), null);
    const checkout = await startCheckout({
      email: "draft-series@example.com", name: "Draft Series", occurrenceIds: [occurrenceId],
      marketingConsent: false, acceptTerms: true, phone: "087 555 6101",
    });
    assert.equal(checkout.ok, false);
  });
}
