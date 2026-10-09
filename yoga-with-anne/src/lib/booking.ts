import { all, get, run, tx, nowIso, audit } from "@/db";
import { getSettings, getDropInPriceCents } from "./settings";
import { quote, type PricingResult, type PricingSeat } from "./pricing";
import { upsertCustomer, entitlementsForCustomer, isNewCustomer, membershipPeriod, normalizeEmail } from "./customers";
import { activeHoldCount, confirmedCount } from "./schedule";
import { sendTemplate, escapeHtml } from "./mail";
import { createStripeRefund } from "./stripe";
import { fmtDateTime, fmtDate } from "./tz";
import { fmtEuro } from "./money";

export type QuoteContext = {
  seats: PricingSeat[];
  customerId?: number | null;
  couponCode?: string | null;
  now?: string;
};

export async function buildQuote(ctx: QuoteContext): Promise<{ result: PricingResult; couponId: number | null; newCustomer: boolean; customerId: number | null }> {
  const settings = await getSettings();
  const now = ctx.now ?? nowIso();

  let rule: { name: string; minDates: number; maxDates: number; perClassCents: number; active: boolean } | null = null;
  const ruleRow = settings.multi_date_discount_enabled
    ? get<{ name: string; min_distinct_dates: number; max_distinct_dates: number; per_class_cents: number; active: number }>(
        `SELECT * FROM discount_rules WHERE kind = 'multi_date' AND active = 1 ORDER BY priority ASC, id ASC LIMIT 1`
      )
    : undefined;
  if (ruleRow) {
    rule = {
      name: ruleRow.name,
      minDates: ruleRow.min_distinct_dates,
      maxDates: ruleRow.max_distinct_dates,
      perClassCents: ruleRow.per_class_cents,
      active: !!ruleRow.active,
    };
  }

  let coupon: { couponId: number; code: string; kind: "percent" | "fixed"; value: number; minTotalCents: number } | null = null;
  if (ctx.couponCode) {
    const c = get<{ id: number; code: string; kind: "percent" | "fixed"; value: number; min_total_cents: number; active: number; starts_at: string | null; ends_at: string | null; max_redemptions: number | null; times_redeemed: number }>(
      `SELECT * FROM coupons WHERE code = ? AND active = 1`,
      normalizeEmail(ctx.couponCode).toUpperCase()
    );
    // codes stored uppercase; retry as-given
    const c2 = c ?? get<NonNullable<typeof c>>(`SELECT * FROM coupons WHERE code = ? AND active = 1`, ctx.couponCode.trim());
    if (c2) {
      const inWindow = (!c2.starts_at || now >= c2.starts_at) && (!c2.ends_at || now <= c2.ends_at);
      const underLimit = c2.max_redemptions == null || c2.times_redeemed < c2.max_redemptions;
      if (inWindow && underLimit) {
        coupon = { couponId: c2.id, code: c2.code, kind: c2.kind, value: c2.value, minTotalCents: c2.min_total_cents };
      }
    }
  }

  const passProducts = all<{ id: number; name: string; price_cents: number; credits: number; validity_weeks: number | null }>(
    settings.class_passes_enabled
      ? `SELECT * FROM products WHERE kind = 'pass' AND active = 1 AND (eligibility = 'all') ORDER BY price_cents ASC`
      : `SELECT * FROM products WHERE 1 = 0`
  ).map((p) => ({ productId: p.id, name: p.name, priceCents: p.price_cents, credits: p.credits, validityWeeks: p.validity_weeks }));

  let introProduct: { productId: number; name: string; priceCents: number; credits: number; validityWeeks: number | null } | null = null;
  const intro = settings.class_passes_enabled
    ? get<{ id: number; name: string; price_cents: number; credits: number; validity_weeks: number | null }>(
        `SELECT * FROM products WHERE kind = 'pass' AND active = 1 AND eligibility = 'new_customer' ORDER BY price_cents ASC LIMIT 1`
      )
    : undefined;
  if (intro) {
    introProduct = { productId: intro.id, name: intro.name, priceCents: intro.price_cents, credits: intro.credits, validityWeeks: intro.validity_weeks };
  }

  let passes: { passId: number; creditsLeft: number; expiresAt: string; label: string }[] = [];
  let membership: { membershipId: number; label: string; classTypeIds: number[] | null; periodStart: string; periodEnd: string } | null = null;
  let newCustomer = false;
  if (ctx.customerId) {
    const ent = await entitlementsForCustomer(ctx.customerId);
    passes = ent.passes.map((p) => ({ passId: p.passId, creditsLeft: p.creditsLeft, expiresAt: p.expiresAt, label: p.label }));
    membership = ent.membership;
    newCustomer = isNewCustomer(ctx.customerId);
  }

  const result = quote({
    seats: ctx.seats,
    dropInCents: await getDropInPriceCents(),
    discountRule: rule,
    coupon,
    passes,
    membership,
    passProducts,
    introProduct,
    isNewCustomer: newCustomer,
    now,
  });
  return { result, couponId: coupon?.couponId ?? null, newCustomer, customerId: ctx.customerId ?? null };
}

export type CheckoutInput = {
  email: string;
  name: string;
  phone?: string | null;
  occurrenceIds: number[];
  marketingConsent: boolean;
  acceptTerms: boolean;
  couponCode?: string | null;
  recurringConsent?: boolean; // required when the order includes a membership
  customerId?: number | null;
  /** Whole-block purchase: one price books every date in the block. */
  blockId?: number | null;
  /** Bundle purchase: one price covering every date of 2+ blocks. */
  bundleId?: number | null;
  /** Named attendee places for a workshop or retreat; ignored for class blocks. */
  attendeeNames?: string[];
};

/** Split a whole-block/bundle price across its dates without losing a cent. */
function distributeCents(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

export type CheckoutOutcome =
  | { ok: true; orderRef: string; orderId: number; mode: "stripe" | "test" }
  | { ok: false; error: string };

function generateRef(): string {
  const alphabet = "ACDEFGHJKLMNPQRTUVWXY3479";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `YA-${s}`;
}

/** Create holds + a pending order atomically. Capacity is re-checked inside the transaction. */
export async function startCheckout(input: CheckoutInput): Promise<CheckoutOutcome> {
  const settings = await getSettings();
  if (!settings.checkout_enabled) return { ok: false, error: "Online booking is temporarily paused. Please contact Anne to book." };
  if (!input.acceptTerms) return { ok: false, error: "Please accept the booking terms to continue." };
  if (!input.email || !input.email.includes("@")) return { ok: false, error: "A valid email address is required." };
  if (!input.name?.trim()) return { ok: false, error: "Please tell us your name." };
  // Mandatory phone: vital for last-minute cancellations/updates via WhatsApp/SMS.
  if ((input.phone ?? "").replace(/[^0-9]/g, "").length < 7) {
    return { ok: false, error: "Please add your mobile number - it's how we reach you about last-minute class changes." };
  }

  // FAIL CLOSED: required booking policies must exist and be published, or no
  // real checkout may proceed. An empty set is never silently accepted.
  const missingPolicies = all<{ title: string }>(
    `SELECT title FROM policies WHERE requires_acceptance = 1 AND status != 'published'`
  );
  if (missingPolicies.length > 0) {
    audit("checkout.blocked_policies", { actorType: "customer", actor: input.email, detail: { count: missingPolicies.length } });
    return {
      ok: false,
      error: `Online booking is temporarily unavailable while our booking terms are being updated. Please check back shortly, or message Anne on ${settings.contact_phone_display} and she'll book you in directly.`,
    };
  }

  const now = nowIso();
  const dropInCents = await getDropInPriceCents();

  // ---------- Whole-block / bundle purchase ----------
  if (input.blockId || input.bundleId) {
    const { getBlock, getBundleView, blockDates, bundleOccurrences, effectivePriceCents } = await import("./blocks");
    let seats: PricingSeat[] = [];
    let lines: { kind: "block" | "bundle"; description: string; qty: number; unitCents: number; totalCents: number; productId?: number; occurrenceId?: number; passId?: number; membershipId?: number }[] = [];
    let total = 0;
    let label = "";
    let seatCount = 1;
    let attendeeNames: string[] = [];

    if (input.blockId) {
      const block = getBlock(input.blockId);
      if (!block || !block.active || block.publication_status !== "published") {
        return { ok: false, error: "This block is not available for booking." };
      }
      const isEvent = block.kind === "workshop" || block.kind === "retreat";
      if (isEvent) {
        attendeeNames = (input.attendeeNames?.length ? input.attendeeNames : [input.name])
          .map((attendee) => attendee.trim())
          .filter(Boolean);
        if (attendeeNames.length === 0 || attendeeNames.length > 20) {
          return { ok: false, error: "Enter a name for each attendee (up to 20 people)." };
        }
        seatCount = attendeeNames.length;
      }
      const dates = blockDates(block).filter((d) => d.status === "scheduled" && d.startsAt > now);
      if (dates.length === 0) return { ok: false, error: "This block has finished." };
      const unitPrice = effectivePriceCents(block, now);
      const totalForBlock = unitPrice * seatCount;
      const shares = distributeCents(totalForBlock, dates.length);
      seats = dates.map((d, i) => ({
        occurrenceId: d.occurrenceId,
        title: d.occurrenceId.toString(),
        startsAt: d.startsAt,
        dateKey: d.dateKey,
        priceCents: shares[i],
        classTypeId: 0,
      }));
      total = totalForBlock;
      label = isEvent
        ? `${block.name} - ${seatCount} attendee${seatCount === 1 ? "" : "s"}`
        : `${block.name} - ${dates.length} class${dates.length === 1 ? "" : "es"}`;
      lines = [{ kind: "block", description: label, qty: seatCount, unitCents: unitPrice, totalCents: total }];
    } else if (input.bundleId) {
      const bundle = await (await import("./blocks")).getBundleView(input.bundleId);
      if (!bundle || !bundle.active || !bundle.published) return { ok: false, error: "This bundle is not available for booking." };
      const parts = bundleOccurrences(input.bundleId);
      if (parts.length < 2) return { ok: false, error: "This bundle is no longer available." };
      const allIds = parts.flatMap((p) => p.occurrenceIds);
      const dateRows = all<{ id: number; starts_at: string; title: string }>(
        `SELECT id, starts_at, title FROM class_occurrences WHERE id IN (${allIds.map(() => "?").join(",")}) AND starts_at > ? AND status = 'scheduled'`,
        ...allIds, now
      );
      if (dateRows.length < 2) return { ok: false, error: "This bundle has finished." };
      const shares = distributeCents(bundle.price_cents, dateRows.length);
      seats = dateRows.map((r, i) => ({
        occurrenceId: r.id,
        title: r.title,
        startsAt: r.starts_at,
        dateKey: r.starts_at.slice(0, 10),
        priceCents: shares[i],
        classTypeId: 0,
      }));
      total = bundle.price_cents;
      label = `${bundle.name} - ${parts.length} blocks, ${dateRows.length} classes`;
      lines = [
        { kind: "bundle", description: label, qty: 1, unitCents: total, totalCents: total },
        ...parts.map((p) => ({ kind: "block" as const, description: `includes ${p.blockName}`, qty: 1, unitCents: 0, totalCents: 0 })),
      ];
    } else {
      return { ok: false, error: "Nothing to book." };
    }

    // duplicate guard across the block/bundle seats
    const customerId = input.customerId ?? upsertCustomer({ email: input.email, name: input.name, phone: input.phone ?? null, marketingConsent: input.marketingConsent, consentSource: "booking" });
    const dup = get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM bookings WHERE customer_id = ? AND status IN ('confirmed','attended')
         AND occurrence_id IN (${seats.map(() => "?").join(",")})`,
      customerId, ...seats.map((s) => s.occurrenceId)
    )!;
    if (dup.c > 0) {
      return { ok: false, error: "You already have a confirmed booking for one of these classes. Check your account or message Anne to change it." };
    }

    const result: PricingResult = {
      seats: seats.map((s) => ({ occurrenceId: s.occurrenceId, source: "paid" as const, priceCents: s.priceCents })),
      lines,
      subtotalCents: total,
      discountCents: 0,
      totalCents: total,
      chosen: { kind: "block", label, explanation: input.blockId && (getBlock(input.blockId)?.kind === "workshop" || getBlock(input.blockId)?.kind === "retreat")
        ? "One booking reserves every named attendee for the whole event."
        : "Block and bundle bookings are non-refundable (terms shown at checkout)." },
      alternatives: [],
    };

    const ref = generateRef();
    const expiresAt = new Date(Date.now() + settings.hold_minutes * 60000).toISOString();
    let orderId: number;
    try {
      orderId = tx(() => {
        if (input.blockId || input.bundleId) {
          // capacity re-check per date inside the write transaction
          for (const seat of seats) {
            const occ = get<{ capacity: number }>(`SELECT capacity FROM class_occurrences WHERE id = ?`, seat.occurrenceId);
            const remaining = occ ? occ.capacity - confirmedCount(seat.occurrenceId) - activeHoldCount(seat.occurrenceId) : 0;
            const needed = input.blockId && (getBlock(input.blockId)?.kind === "workshop" || getBlock(input.blockId)?.kind === "retreat") ? seatCount : 1;
            if (remaining < needed) throw new Error(`SOLD_OUT:${seat.occurrenceId}`);
          }
        }
        const oRes = run(
          `INSERT INTO orders (ref, customer_id, status, subtotal_cents, discount_cents, total_cents, currency, pricing_snapshot, checkout_mode, expires_at, policy_versions, created_at, updated_at)
           VALUES (?,?, 'awaiting_payment', ?, 0, ?, ?, ?, NULL, ?, ?, ?, ?)`,
          ref, customerId, total, total, settings.currency,
          JSON.stringify({ result, occurrenceIds: seats.map((s) => s.occurrenceId), generatedAt: now, blockId: input.blockId ?? null, bundleId: input.bundleId ?? null, seatCount, attendeeNames }),
          expiresAt, JSON.stringify(awaitPolicies()), now, now
        );
        const newOrderId = Number(oRes.lastInsertRowid);
        for (const line of lines) {
          run(
            `INSERT INTO order_items (order_id, kind, description, qty, unit_cents, total_cents) VALUES (?,?,?,?,?,?)`,
            newOrderId, line.kind, line.description, line.qty, line.unitCents, line.totalCents
          );
        }
        for (const seat of seats) {
          run(
            `INSERT INTO capacity_holds (occurrence_id, order_id, qty, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            seat.occurrenceId, newOrderId, input.blockId && (getBlock(input.blockId)?.kind === "workshop" || getBlock(input.blockId)?.kind === "retreat") ? seatCount : 1, input.email.toLowerCase(), expiresAt, now
          );
        }
        return newOrderId;
      });
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("SOLD_OUT")) {
        return { ok: false, error: "Someone just took a place in this block while you were booking. One of the dates is now full." };
      }
      throw e;
    }
    audit("checkout.started", { actorType: "customer", actor: input.email, entityType: "order", entityId: orderId, detail: { ref, total, kind: input.blockId ? "block" : "bundle" } });
    return { ok: true, orderRef: ref, orderId, mode: stripeEnabled() ? "stripe" : "test" };
  }

  const occurrences = input.occurrenceIds.length
    ? all<{ id: number; title: string; starts_at: string; ends_at: string; capacity: number; status: string; publication_status: string; series_publication_status: string | null; series_id: number | null; booking_close_at: string | null; booking_open_at: string | null; waitlist_enabled: number; price_override_cents: number | null; class_type_id: number }>(
        `SELECT o.*, s.publication_status AS series_publication_status FROM class_occurrences o LEFT JOIN class_series s ON s.id = o.series_id WHERE o.id IN (${input.occurrenceIds.map(() => "?").join(",")})`,
        ...input.occurrenceIds
      )
    : [];
  if (occurrences.length !== input.occurrenceIds.length) return { ok: false, error: "One of the selected classes is no longer available." };

  const seats: PricingSeat[] = [];
  for (const o of occurrences) {
    if (o.publication_status !== "published" || (o.series_id && o.series_publication_status !== "published")) {
      return { ok: false, error: `“${o.title}” is not available for booking.` };
    }
    if (o.status !== "scheduled") return { ok: false, error: `“${o.title}” is cancelled and cannot be booked.` };
    if (o.booking_open_at && now < o.booking_open_at) return { ok: false, error: `Booking for “${o.title}” has not opened yet.` };
    if (o.booking_close_at && now > o.booking_close_at) return { ok: false, error: `Booking for “${o.title}” has closed.` };
    const remaining = o.capacity - confirmedCount(o.id) - activeHoldCount(o.id);
    if (remaining < 1) return { ok: false, error: `“${o.title}” just sold out. You can join the waitlist instead.` };
    seats.push({
      occurrenceId: o.id,
      title: `${o.title} - ${fmtDateTime(o.starts_at, o.ends_at, settings.timezone)}`,
      startsAt: o.starts_at,
      dateKey: o.starts_at.slice(0, 10),
      priceCents: o.price_override_cents ?? dropInCents,
      classTypeId: o.class_type_id,
    });
  }

  const customerId = input.customerId ?? upsertCustomer({
    email: input.email,
    name: input.name,
    phone: input.phone ?? null,
    marketingConsent: input.marketingConsent,
    consentSource: "booking",
  });

  // duplicate booking guard: same customer already confirmed into one of these classes
  const duplicate = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM bookings WHERE customer_id = ? AND status IN ('confirmed','attended')
       AND occurrence_id IN (${input.occurrenceIds.map(() => "?").join(",") || "0"})`,
    customerId,
    ...input.occurrenceIds
  )!;
  if (duplicate.c > 0) {
    return { ok: false, error: "You already have a confirmed booking for one of these classes. Check your account or message Anne to change it." };
  }
  // also block a second in-flight checkout by the same email for the same classes
  const inflight = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM capacity_holds WHERE email = ? AND released = 0 AND expires_at > ?
       AND occurrence_id IN (${input.occurrenceIds.map(() => "?").join(",") || "0"})`,
    input.email.toLowerCase(),
    now,
    ...input.occurrenceIds
  )!;
  if (inflight.c > 0) {
    return { ok: false, error: "You already have these places held in another checkout. Finish or wait for it to expire (about 10 minutes)." };
  }

  const { result, couponId } = await buildQuote({ seats, customerId, couponCode: input.couponCode, now });

  const hasMembership = false; // memberships are bought standalone from the prices page
  if (hasMembership && !input.recurringConsent) {
    return { ok: false, error: "Please confirm you understand the membership renews automatically." };
  }

  const expiresAt = new Date(Date.now() + settings.hold_minutes * 60000).toISOString();
  const ref = generateRef();

  let orderId: number;
  try {
    orderId = tx(() => {
      // re-check capacity inside the write transaction (last-seat race)
      for (const o of occurrences) {
        const remaining = o.capacity - confirmedCount(o.id) - activeHoldCount(o.id);
        if (remaining < 1) throw new Error(`SOLD_OUT:${o.id}`);
      }
      // coupon reservation: consume one redemption atomically so the final
      // permitted use cannot be double-sold. Released again if never paid.
      if (couponId) {
        const claimed = run(
          `UPDATE coupons SET times_redeemed = times_redeemed + 1
           WHERE id = ? AND (max_redemptions IS NULL OR times_redeemed < max_redemptions)`,
          couponId
        );
        if (claimed.changes === 0) throw new Error("COUPON_EXHAUSTED");
      }
      const oRes = run(
        `INSERT INTO orders (ref, customer_id, status, subtotal_cents, discount_cents, total_cents, currency, pricing_snapshot, coupon_id, recurring_consent, checkout_mode, expires_at, policy_versions, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ref,
        customerId,
        "awaiting_payment",
        result.subtotalCents,
        result.discountCents,
        result.totalCents,
        settings.currency,
        JSON.stringify({ result, occurrenceIds: input.occurrenceIds, generatedAt: now, couponCode: input.couponCode ?? null }),
        couponId,
        input.recurringConsent ? 1 : 0,
        null,
        expiresAt,
        JSON.stringify(awaitPolicies()),
        now,
        now
      );
      const newOrderId = Number(oRes.lastInsertRowid);
      for (const line of result.lines) {
        run(
          `INSERT INTO order_items (order_id, kind, occurrence_id, product_id, description, qty, unit_cents, total_cents, meta) VALUES (?,?,?,?,?,?,?,?,?)`,
          newOrderId,
          line.kind,
          line.occurrenceId ?? null,
          line.productId ?? null,
          line.description,
          line.qty,
          line.unitCents,
          line.totalCents,
          line.passId ? JSON.stringify({ passId: line.passId }) : line.membershipId ? JSON.stringify({ membershipId: line.membershipId }) : null
        );
      }
      for (const seat of result.seats) {
        run(
          `INSERT INTO capacity_holds (occurrence_id, order_id, qty, email, expires_at, created_at) VALUES (?, ?, 1, ?, ?, ?)`,
          seat.occurrenceId,
          newOrderId,
          input.email.toLowerCase(),
          expiresAt,
          now
        );
      }
      return newOrderId;
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("SOLD_OUT")) {
      return { ok: false, error: "Someone just took the last place while you were booking. You can join the waitlist instead." };
    }
    if (e instanceof Error && e.message === "COUPON_EXHAUSTED") {
      return { ok: false, error: "That coupon code has just been used up. Remove it to continue at the standard price." };
    }
    throw e;
  }

  audit("checkout.started", { actorType: "customer", actor: input.email, entityType: "order", entityId: orderId, detail: { ref, total: result.totalCents } });
  return { ok: true, orderRef: ref, orderId, mode: stripeEnabled() ? "stripe" : "test" };
}

function awaitPolicies(): { slug: string; version: number }[] {
  const rows = all<{ slug: string; version: number }>(
    `SELECT slug, version FROM policies WHERE requires_acceptance = 1 AND status = 'published'`
  );
  return rows.map((r) => ({ slug: r.slug, version: r.version }));
}

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export type PaidOutcome = { ok: boolean; alreadyPaid: boolean; error?: string; lateRecovered?: boolean; refundRequired?: boolean };

/**
 * Idempotently mark an order paid and materialise its effects:
 * bookings, pass rows + credit ledger, membership, payment row, policy acceptance.
 *
 * Late payments: a Stripe Checkout session can outlive the local hold/order
 * expiry. When a genuinely paid event arrives for an expired order we either
 * (a) atomically re-acquire every required seat and fulfil normally, or
 * (b) record the charge as refund_required (auto-refunded when Stripe is
 * configured) and notify the customer. A paid-but-silent state is impossible.
 */
export async function markOrderPaid(
  ref: string,
  payment: { provider: "stripe" | "test" | "offline"; providerRef?: string | null; amountCents?: number | null; method?: string | null },
  opts: { offline?: boolean; skipEmail?: boolean; subscriptionId?: string | null } = {}
): Promise<PaidOutcome> {
  const settings = await getSettings();
  const now = nowIso();
  let outcome: PaidOutcome = { ok: true, alreadyPaid: false };
  type LateRefund = { orderId: number; providerRef: string; amountCents: number; customerEmail: string };
  let lateRefund: LateRefund | null = null;
  const takeLateRefund = (): LateRefund | null => (lateRefund as LateRefund | null);
  let duplicateSeatValue = 0;
  let duplicateSeatOrder = 0;
  tx(() => {
    const order = get<{ id: number; status: string; customer_id: number; total_cents: number; coupon_id: number | null; policy_versions: string | null; pricing_snapshot: string | null; recurring_consent: number; recovery: string | null }>(
      `SELECT * FROM orders WHERE ref = ?`,
      ref
    );
    if (!order) {
      outcome = { ok: false, alreadyPaid: false, error: "Order not found" };
      return;
    }
    if (order.status === "paid" || order.recovery === "refund_required" || order.recovery === "refunded") {
      outcome = { ok: true, alreadyPaid: true };
      return;
    }
    const isLate = order.status === "expired";
    if (order.status !== "awaiting_payment" && order.status !== "pending" && !isLate) {
      outcome = { ok: false, alreadyPaid: false, error: `Order is ${order.status}` };
      return;
    }

    const snapshot = order.pricing_snapshot ? (JSON.parse(order.pricing_snapshot) as { result: PricingResult; occurrenceIds: number[]; seatCount?: number; attendeeNames?: string[] }) : null;
    const result = snapshot?.result;

    // ---- Late payment: fulfil only if every required seat can still be re-acquired
    if (isLate && snapshot && snapshot.occurrenceIds.length > 0) {
      const seatsPerOccurrence = Math.max(1, snapshot.seatCount ?? 1);
      for (const occId of snapshot.occurrenceIds) {
        const occ = get<{ capacity: number }>(`SELECT capacity FROM class_occurrences WHERE id = ?`, occId);
        const remaining = occ ? occ.capacity - confirmedCount(occId) - activeHoldCount(occId) : 0;
        if (remaining < seatsPerOccurrence) {
          // Money was taken but the seats are gone - record the charge and flag
          // for refund. Never fulfil silently, never oversell.
          const existingPayment = payment.providerRef ? get(`SELECT id FROM payments WHERE provider_ref = ?`, payment.providerRef) : undefined;
          if (!existingPayment) {
            run(
              `INSERT INTO payments (order_id, provider, provider_ref, amount_cents, status, method, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
              order.id, payment.provider, payment.providerRef ?? `${payment.provider}-${ref}`,
              payment.amountCents ?? order.total_cents, "succeeded", payment.method ?? null, now, now
            );
          }
          run(`UPDATE orders SET recovery = 'refund_required', updated_at = ? WHERE id = ?`, now, order.id);
          run(`UPDATE capacity_holds SET released = 1 WHERE order_id = ?`, order.id);
          audit("order.late_payment_unfulfilled", {
            actorType: "system", entityType: "order", entityId: order.id,
            detail: { ref, provider: payment.provider, amount: order.total_cents, reason: "capacity lost after local expiry" },
          });
          const email = get<{ email: string }>(`SELECT email FROM customers WHERE id = ?`, order.customer_id);
          lateRefund = {
            orderId: order.id,
            providerRef: payment.providerRef ?? `${payment.provider}-${ref}`,
            amountCents: payment.amountCents ?? order.total_cents,
            customerEmail: email?.email ?? "",
          };
          outcome = { ok: false, alreadyPaid: false, error: "order expired and seats no longer available - refund required", refundRequired: true };
          return;
        }
      }
      // every seat still available → fall through to normal fulfilment
      outcome = { ok: true, alreadyPaid: false, lateRecovered: true };
    }

    run(`UPDATE orders SET status = 'paid', paid_at = ?, checkout_mode = ?, offline = ?, recovery = NULL, updated_at = ? WHERE id = ?`,
      now, payment.provider === "offline" ? "offline" : payment.provider, opts.offline ? 1 : 0, now, order.id);
    // holds are consumed - seats are now real bookings
    run(`UPDATE capacity_holds SET released = 1 WHERE order_id = ?`, order.id);

    // payment row (idempotent on provider_ref)
    const existingPayment = payment.providerRef
      ? get(`SELECT id FROM payments WHERE provider_ref = ?`, payment.providerRef)
      : undefined;
    if (!existingPayment) {
      run(
        `INSERT INTO payments (order_id, provider, provider_ref, amount_cents, status, method, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
        order.id,
        payment.provider,
        payment.providerRef ?? `${payment.provider}-${ref}`,
        payment.amountCents ?? order.total_cents,
        "succeeded",
        payment.method ?? null,
        now,
        now
      );
    }

    // coupon redemptions are RESERVED at checkout start (see startCheckout) -
    // nothing to increment here; expired orders release the reservation instead.

    // record accepted policy versions (required policies were verified published at checkout)
    const acceptedPolicies = order.policy_versions ? (JSON.parse(order.policy_versions) as { slug: string; version: number }[]) : [];
    for (const pv of acceptedPolicies) {
      run(
        `INSERT INTO policy_acceptances (customer_id, order_id, policy_slug, version) VALUES (?,?,?,?)`,
        order.customer_id, order.id, pv.slug, pv.version
      );
    }

    const titleById = new Map<number, string>();
    if (snapshot) {
      const occRows = all<{ id: number; title: string }>(
        `SELECT id, title FROM class_occurrences WHERE id IN (${snapshot.occurrenceIds.map(() => "?").join(",") || "0"})`,
        ...snapshot.occurrenceIds
      );
      for (const r of occRows) titleById.set(r.id, r.title);
    }
    void titleById;

    const classLineByOcc = new Map<number, { unitCents: number; lineId: number }>();
    if (result) {
      for (const line of result.lines) {
        if (line.kind === "class" && line.occurrenceId) {
          const item = get<{ id: number }>(`SELECT id FROM order_items WHERE order_id = ? AND occurrence_id = ? AND kind = 'class'`, order.id, line.occurrenceId);
          classLineByOcc.set(line.occurrenceId, { unitCents: line.unitCents, lineId: item?.id ?? 0 });
        }
      }
    }

    // Purchased passes come from order_items (authoritative), so standalone pass
    // orders without a pricing snapshot also materialise correctly.
    const passLines: { productId: number }[] = all<{ product_id: number }>(
      `SELECT product_id FROM order_items WHERE order_id = ? AND kind = 'pass' AND product_id IS NOT NULL`,
      order.id
    ).map((r) => ({ productId: r.product_id }));

    // create pass products purchased
    const newPassIds: { passId: number; productId: number }[] = [];
    for (const pl of passLines) {
      const prod = get<{ id: number; credits: number; validity_weeks: number | null; name: string }>(`SELECT * FROM products WHERE id = ?`, pl.productId);
      if (!prod) continue;
      const validFrom = now;
      const expires = new Date(Date.now() + (prod.validity_weeks ?? 8) * 7 * 24 * 3600 * 1000).toISOString();
      const pRes = run(
        `INSERT INTO passes (customer_id, product_id, order_id, credits_total, valid_from, expires_at, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        order.customer_id, prod.id, order.id, prod.credits, validFrom, expires, "active", now, now
      );
      const passId = Number(pRes.lastInsertRowid);
      newPassIds.push({ passId, productId: prod.id });
      run(
        `INSERT INTO pass_credit_ledger (pass_id, delta, reason, order_id, actor, note, created_at) VALUES (?, ?, 'purchase', ?, 'system', ?, ?)`,
        passId, prod.credits, order.id, `Purchased ${prod.name}`, now
      );
    }

    // bookings for each covered seat
    if (result) {
      for (const seat of result.seats) {
        const lineInfo = classLineByOcc.get(seat.occurrenceId);
        const source = seat.source === "pass" ? "pass" : seat.source === "membership" ? "membership" : "online";
        const res = run(
          `INSERT OR IGNORE INTO bookings (occurrence_id, customer_id, order_id, order_item_id, status, seat_count, source, price_cents, created_at, updated_at)
           VALUES (?,?,?,?, 'confirmed', ?, ?, ?, ?, ?)`,
          seat.occurrenceId, order.customer_id, order.id, lineInfo?.lineId ?? null, snapshot?.seatCount ?? 1, source, seat.priceCents, now, now
        );
        const bookingId = Number(res.lastInsertRowid);
        if (bookingId === 0) {
          // already booked (race / duplicate) - the customer paid for a seat they
          // will not receive; flag the order for refund exactly like a late payment.
          audit("booking.duplicate_skipped", { actorType: "system", entityType: "order", entityId: order.id, detail: { occurrenceId: seat.occurrenceId } });
          duplicateSeatValue += lineInfo?.unitCents ?? seat.priceCents;
          duplicateSeatOrder = order.id;
          continue;
        }
        if (snapshot?.attendeeNames?.length) {
          snapshot.attendeeNames.forEach((name, index) => {
            run(`INSERT INTO booking_attendees (booking_id, name, sort) VALUES (?,?,?)`, bookingId, name, index);
          });
        }
        if (seat.source === "pass") {
          // entitlement seat: return credit to the original pass; newly purchased pass: deduct from it
          const passId = seat.passId ?? newPassIds[0]?.passId;
          if (passId) {
            run(
              `INSERT INTO pass_credit_ledger (pass_id, delta, reason, booking_id, order_id, actor, created_at) VALUES (?, -1, 'redeemed', ?, ?, 'system', ?)`,
              passId, bookingId, order.id, now
            );
          }
        }
      }
    }

    // memberships purchased in this order become active at confirmation
    const membershipItems = all<{ product_id: number }>(
      `SELECT product_id FROM order_items WHERE order_id = ? AND kind = 'membership' AND product_id IS NOT NULL`,
      order.id
    );
    const newMemberships: { customerId: number; productName: string; periodEnd: string }[] = [];
    for (const mi of membershipItems) {
      const existing = get(`SELECT id FROM memberships WHERE order_id = ?`, order.id);
      if (existing) break;
      const prod = get<{ recurrence: string | null; name: string }>(`SELECT * FROM products WHERE id = ?`, mi.product_id);
      if (!prod) break;
      const period = membershipPeriod(prod.recurrence === "annual" ? "annual" : "monthly", now, settings.timezone);
      run(
        `INSERT INTO memberships (customer_id, product_id, order_id, status, current_period_start, current_period_end, stripe_subscription_id, created_at, updated_at)
         VALUES (?,?,?, 'active', ?,?,?,?,?)`,
        order.customer_id, mi.product_id, order.id, period.start, period.end, opts.subscriptionId ?? null, now, now
      );
      newMemberships.push({ customerId: order.customer_id, productName: prod.name, periodEnd: period.end });
    }

    audit("order.paid", { actorType: "system", actor: payment.provider, entityType: "order", entityId: order.id, detail: { ref, provider: payment.provider, amount: order.total_cents } });
    (outcome as { newMemberships?: typeof newMemberships }).newMemberships = newMemberships;
  });

  if (duplicateSeatOrder && duplicateSeatValue > 0) {
    run(`UPDATE orders SET recovery = 'refund_required', updated_at = ? WHERE id = ? AND recovery IS NULL`, nowIso(), duplicateSeatOrder);
    audit("order.paid_unfulfilled_seat", { actorType: "system", entityType: "order", entityId: duplicateSeatOrder, detail: { value: duplicateSeatValue } });
  }

  if (!outcome.ok || outcome.alreadyPaid) {
    // Late payment that could not be fulfilled: refund automatically when
    // Stripe is configured, and always tell the customer what happened.
    const lr = takeLateRefund();
    if (lr) {
      let refunded = false;
      if (payment.provider === "stripe" && stripeEnabled() && payment.providerRef?.startsWith("pi_")) {
        const r = await createStripeRefund(payment.providerRef, lr.amountCents, "class sold out before payment completed");
        refunded = r.ok;
        if (r.ok && r.refundId) {
          tx(() => {
            const pay = get<{ id: number }>(`SELECT id FROM payments WHERE provider_ref = ?`, payment.providerRef!)!;
            if (pay) {
              run(`INSERT INTO refunds (payment_id, amount_cents, provider, provider_ref, reason, actor) VALUES (?,?,?,?,?,?)`,
                pay.id, lr.amountCents, "stripe", r.refundId, "late payment - seats sold out", "system");
              run(`UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?`, nowIso(), pay.id);
              run(`UPDATE orders SET recovery = 'refunded', updated_at = ? WHERE id = ?`, nowIso(), lr.orderId);
            }
          });
        }
      }
      if (lr.customerEmail && !opts.skipEmail) {
        await sendTemplate("booking_cancelled", lr.customerEmail, {
          customer_name: "there",
          class_title: `your booking ${ref}`,
          class_when: "",
          credit_note: "",
          refund_note: refunded
            ? `Your payment of ${fmtEuro(lr.amountCents)} has been refunded in full - the class sold out before your payment reached us. It can take a few days to appear on your statement.`
            : `Your payment of ${fmtEuro(lr.amountCents)} will be refunded in full - the class sold out before your payment reached us. Anne has been notified and will process the refund; no action is needed.`,
        }, { relatedType: "order", relatedId: lr.orderId });
      }
    }
    return outcome;
  }

  // Post-confirmation emails (outside tx; failures are logged, never fatal)
  if (!opts.skipEmail) {
    await sendOrderConfirmation(ref, settings.timezone);
    const memberships = (outcome as { newMemberships?: { customerId: number; productName: string; periodEnd: string }[] }).newMemberships ?? [];
    for (const m of memberships) {
      const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, m.customerId);
      if (customer) {
        await sendTemplate("membership_started", customer.email, {
          customer_name: customer.name ?? "there",
          membership_name: m.productName,
          renewal_date: fmtDate(m.periodEnd, settings.timezone, true),
        });
      }
    }
  }
  return outcome;
}

export async function sendOrderConfirmation(ref: string, tz: string) {
  const order = get<{ id: number; customer_id: number; total_cents: number; pricing_snapshot: string | null }>(`SELECT * FROM orders WHERE ref = ?`, ref);
  if (!order) return;
  const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, order.customer_id);
  if (!customer) return;
  const bookings = all<{ id: number; occurrence_id: number }>(`SELECT id, occurrence_id FROM bookings WHERE order_id = ? ORDER BY occurrence_id`, order.id);
  let classDetails = "";
  const whatToBringLines = new Set<string>();
  for (const booking of bookings) {
    const o = get<{ title: string; starts_at: string; ends_at: string; venue_name: string | null; venue_address: string | null; what_to_bring: string | null; event_kind: string | null; event_start_date: string | null; event_end_date: string | null }>(
      `SELECT o.title, o.starts_at, o.ends_at, v.name AS venue_name, v.address AS venue_address, ct.what_to_bring,
         cb.kind AS event_kind, cb.start_date AS event_start_date, cb.end_date AS event_end_date
       FROM class_occurrences o
       LEFT JOIN venues v ON v.id = o.venue_id
       LEFT JOIN class_types ct ON ct.id = o.class_type_id
       LEFT JOIN class_blocks cb ON cb.series_id = o.series_id AND cb.kind IN ('workshop','retreat')
       WHERE o.id = ?`,
      booking.occurrence_id
    );
    if (!o) continue;
    const bring = o.what_to_bring?.trim();
    if (bring) whatToBringLines.add(bring);
    const when = o.event_start_date && o.event_end_date
      ? `${fmtDate(`${o.event_start_date}T12:00:00.000Z`, tz, true)} – ${fmtDate(`${o.event_end_date}T12:00:00.000Z`, tz, true)}`
      : fmtDateTime(o.starts_at, o.ends_at, tz);
    const attendees = all<{ name: string }>(`SELECT name FROM booking_attendees WHERE booking_id = ? ORDER BY sort, id`, booking.id);
    const attendeeLine = attendees.length ? `<br>Attendees: ${attendees.map((attendee) => escapeHtml(attendee.name)).join(", ")}` : "";
    classDetails += `<p style="margin:0 0 12px;"><strong>${escapeHtml(o.title)}</strong><br>${when}${attendeeLine}<br>${o.venue_name ? escapeHtml(o.venue_name + (o.venue_address ? ", " + o.venue_address : "")) : ""}${bring ? `<br><em>Bring: ${escapeHtml(bring)}</em>` : ""}</p>`;
  }
  const bookingUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/account`;
  await sendTemplate(
    "booking_confirmation",
    customer.email,
    {
      customer_name: customer.name ?? "there",
      class_details_html: classDetails,
      total: fmtEuro(order.total_cents),
      booking_url: bookingUrl,
      what_to_bring: [...whatToBringLines].join(" ") || "Comfortable clothes and water.",
    },
    { relatedType: "order", relatedId: order.id }
  );
}

/** Release expired holds (lazy; safe to call on every schedule view). */
export function releaseExpiredHolds(): void {
  run(
    `UPDATE capacity_holds SET released = 1
     WHERE released = 0 AND expires_at <= ?
       AND order_id IN (SELECT id FROM orders WHERE status IN ('pending','awaiting_payment'))`,
    nowIso()
  );
  // release coupon reservations for orders that will now expire unpaid
  const expiring = all<{ id: number; coupon_id: number | null }>(
    `SELECT id, coupon_id FROM orders WHERE status IN ('pending','awaiting_payment') AND expires_at <= ? AND coupon_id IS NOT NULL`,
    nowIso()
  );
  run(
    `UPDATE orders SET status = 'expired', updated_at = ?
     WHERE status IN ('pending','awaiting_payment') AND expires_at <= ?`,
    nowIso(),
    nowIso()
  );
  for (const o of expiring) {
    if (o.coupon_id) {
      run(`UPDATE coupons SET times_redeemed = MAX(times_redeemed - 1, 0) WHERE id = ?`, o.coupon_id);
    }
  }
}

export type CancelOutcome = { ok: boolean; message: string; creditReturned: boolean; refundPending: boolean };

/**
 * Shared cancellation settlement for ONE booking. Idempotent by status:
 * anything not 'confirmed' is a no-op. Returns what happened so callers can
 * compose exactly one customer notification.
 */
function settleBookingCancellation(bookingId: number, actor: string, actorType: "admin" | "customer", reason?: string): { withinCutoff: boolean; creditReturned: boolean; refundPending: boolean; title: string; startsAt: string; customerId: number } | null {
  const settings = getSettingsSync();
  const booking = get<{ id: number; occurrence_id: number; customer_id: number; order_id: number | null; status: string; source: string; price_cents: number }>(
    `SELECT * FROM bookings WHERE id = ?`, bookingId
  );
  if (!booking || booking.status !== "confirmed") return null;
  const occ = get<{ starts_at: string; title: string }>(`SELECT starts_at, title FROM class_occurrences WHERE id = ?`, booking.occurrence_id)!;
  const now = nowIso();
  const cutoffMs = settings.cancellation_cutoff_hours * 3600 * 1000;
  const withinCutoff = new Date(occ.starts_at).getTime() - new Date(now).getTime() > cutoffMs;

  let creditReturned = false;
  let refundPending = false;

  run(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?`, now, reason ?? null, now, booking.id);

  if (booking.source === "pass") {
    // restore the redeemed credit exactly once (guard: only if a redemption row exists)
    const ledger = get<{ pass_id: number }>(
      `SELECT pass_id FROM pass_credit_ledger WHERE booking_id = ? AND delta < 0`, booking.id
    );
    if (ledger) {
      const alreadyReturned = get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM pass_credit_ledger WHERE booking_id = ? AND delta > 0 AND reason = 'returned'`, booking.id
      )!.c;
      const pass = get<{ status: string; expires_at: string }>(`SELECT status, expires_at FROM passes WHERE id = ?`, ledger.pass_id);
      if (!alreadyReturned && pass && pass.status === "active" && pass.expires_at > now) {
        run(`INSERT INTO pass_credit_ledger (pass_id, delta, reason, booking_id, actor, note, created_at) VALUES (?, 1, 'returned', ?, ?, ?, ?)`,
          ledger.pass_id, booking.id, actor, "Credit returned on cancellation", now);
        creditReturned = true;
      }
    }
  }
  if (booking.source === "online" && booking.order_id && booking.price_cents > 0) {
    // flag the order so the owner (or the Stripe integration) settles the refund
    run(`UPDATE orders SET recovery = 'refund_required', updated_at = ? WHERE id = ? AND recovery IS NULL`, now, booking.order_id);
    refundPending = true;
  }
  audit("booking.cancelled", { actorType, actor, entityType: "booking", entityId: booking.id, detail: { withinCutoff, reason } });
  return { withinCutoff, creditReturned, refundPending, title: occ.title, startsAt: occ.starts_at, customerId: booking.customer_id };
}

export async function cancelBooking(bookingId: number, actor: string, actorType: "admin" | "customer", reason?: string, opts: { notify?: boolean } = {}): Promise<CancelOutcome> {
  const settings = await getSettings();
  // Blocks and bundles are sold non-refundable (FRS 3.3): students self-cancel
  // regular bookings only. Anne can always cancel on their behalf.
  if (actorType === "customer") {
    const bookingKind = get<{ order_id: number | null }>(`SELECT order_id FROM bookings WHERE id = ?`, bookingId);
    if (bookingKind?.order_id) {
      const special = get<{ kind: string }>(
        `SELECT kind FROM order_items WHERE order_id = ? AND kind IN ('block','bundle') LIMIT 1`,
        bookingKind.order_id
      );
      if (special) {
        return { ok: false, message: "Block and bundle bookings are non-refundable. If you can't make a class, message Anne - she'll always try to help.", creditReturned: false, refundPending: false };
      }
    }
  }
  const settled = tx(() => settleBookingCancellation(bookingId, actor, actorType, reason));
  if (!settled) return { ok: false, message: "This booking is not active or does not exist.", creditReturned: false, refundPending: false };

  // offer the freed seat to the waitlist
  await offerNextWaitlistSeat(bookingOccurrenceId(bookingId));

  if (opts.notify !== false && !optsNoEmail()) {
    const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, settled.customerId);
    if (customer) {
      await sendTemplate(
        "booking_cancelled",
        customer.email,
        {
          customer_name: customer.name ?? "there",
          class_title: settled.title,
          class_when: fmtDateTime(settled.startsAt, settled.startsAt, settings.timezone),
          credit_note: settled.creditReturned ? "Your pass credit has been returned and is ready to use again." : "",
          refund_note: settled.refundPending ? "A refund will be processed to your original payment method - no action is needed." : "",
        },
        { relatedType: "booking", relatedId: bookingId }
      );
    }
  }

  return {
    ok: true,
    message: settled.withinCutoff
      ? "Booking cancelled."
      : "Booking cancelled. This was inside the late-cancellation window, so no automatic refund applies.",
    creditReturned: settled.creditReturned,
    refundPending: settled.refundPending,
  };
}

function bookingOccurrenceId(bookingId: number): number {
  return get<{ occurrence_id: number }>(`SELECT occurrence_id FROM bookings WHERE id = ?`, bookingId)!.occurrence_id;
}

/**
 * Organiser cancels a WHOLE class occurrence: settles every booking through the
 * same domain logic as individual cancellation (pass credits restored exactly
 * once, online payments flagged refund_required), invalidates the waitlist
 * (no promotions from a cancelled class), and sends exactly one clear email
 * per attendee. Safe to repeat.
 */
export async function cancelOccurrence(occurrenceId: number, actor: string, reason: string): Promise<{ notified: number }> {
  const settings = await getSettings();
  const now = nowIso();
  run(`UPDATE class_occurrences SET status = 'cancelled', updated_at = ? WHERE id = ? AND status != 'cancelled'`, now, occurrenceId);

  const attendees = all<{ id: number; customer_id: number }>(
    `SELECT id, customer_id FROM bookings WHERE occurrence_id = ? AND status = 'confirmed'`,
    occurrenceId
  );
  const notified: { email: string; name: string | null }[] = [];
  for (const b of attendees) {
    const settled = tx(() => settleBookingCancellation(b.id, actor, "admin", reason || "Class cancelled by the organiser"));
    if (!settled) continue;
    const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, settled.customerId);
    if (customer) notified.push(customer);
  }

  // a cancelled class never promotes its waitlist - invalidate everything
  tx(() => {
    run(`UPDATE waitlist_entries SET status = 'cancelled', updated_at = ? WHERE occurrence_id = ? AND status IN ('waiting','offered')`, now, occurrenceId);
  });
  audit("occurrence.cancelled_settled", { actorType: "admin", actor, entityType: "occurrence", entityId: occurrenceId, detail: { bookings: attendees.length, notified: notified.length } });

  if (!optsNoEmail()) {
    for (const c of notified) {
      await sendTemplate("class_changed", c.email, {
        customer_name: c.name ?? "there",
        class_title: get<{ title: string }>(`SELECT title FROM class_occurrences WHERE id = ?`, occurrenceId)?.title ?? "your class",
        class_when: "",
        change_message: `Unfortunately this class has been cancelled${reason ? `: ${reason}` : "."} ${
          "Anne will be in touch to arrange a refund, credit, or transfer to another date where applicable. Reply to this email or WhatsApp Anne if you have questions."
        }`,
      }, { relatedType: "occurrence", relatedId: occurrenceId });
    }
  }
  return { notified: notified.length };
}

export type EventTransferOutcome =
  | { ok: true; transferId: number; refundDueCents: number; adjustmentPaidCents: number }
  | { ok: false; error: string };

/** Move a cancelled Workshop/Retreat group to another published event without losing its order. */
export function transferEventBooking(input: {
  bookingId: number;
  targetOccurrenceId: number;
  attendeeNames: string[];
  paymentMethod?: "cash" | "transfer" | "recorded";
  actor: string;
  note?: string | null;
}): EventTransferOutcome {
  const now = nowIso();
  try {
    return tx(() => {
      const booking = get<{
        id: number; occurrence_id: number; customer_id: number; order_id: number | null;
        seat_count: number; status: string; price_cents: number;
      }>(`SELECT id, occurrence_id, customer_id, order_id, seat_count, status, price_cents FROM bookings WHERE id = ?`, input.bookingId);
      if (!booking || booking.status !== "cancelled") return { ok: false as const, error: "Only a cancelled event booking can be transferred." };
      const source = get<{ status: string; kind: string }>(
        `SELECT o.status, b.kind FROM class_occurrences o JOIN class_blocks b ON b.series_id = o.series_id WHERE o.id = ?`,
        booking.occurrence_id
      );
      if (!source || source.status !== "cancelled" || !["workshop", "retreat"].includes(source.kind)) {
        return { ok: false as const, error: "This booking is not from a cancelled Workshop or Retreat." };
      }
      const target = get<{
        id: number; starts_at: string; capacity: number; status: string; kind: string;
        block_id: number; price_cents: number; block_active: number; block_status: string; series_status: string;
      }>(
        `SELECT o.id, o.starts_at, o.capacity, o.status, b.kind, b.id AS block_id, b.price_cents,
           b.active AS block_active, b.publication_status AS block_status, s.publication_status AS series_status
         FROM class_occurrences o JOIN class_series s ON s.id = o.series_id JOIN class_blocks b ON b.series_id = s.id
         WHERE o.id = ?`, input.targetOccurrenceId
      );
      if (!target || target.kind !== source.kind || target.status !== "scheduled" || target.starts_at <= now ||
        !target.block_active || target.block_status !== "published" || target.series_status !== "published") {
        return { ok: false as const, error: "Choose a future published event of the same type that is on sale." };
      }
      const names = input.attendeeNames.map((name) => name.trim()).filter(Boolean);
      if (names.length !== booking.seat_count || names.some((name) => name.length > 120)) {
        return { ok: false as const, error: `Enter one attendee name for each of the ${booking.seat_count} places (up to 120 characters each).` };
      }
      if (get(`SELECT id FROM bookings WHERE occurrence_id = ? AND customer_id = ? AND status IN ('confirmed','attended')`, target.id, booking.customer_id)) {
        return { ok: false as const, error: "This payer already has an active booking for the replacement event." };
      }
      const available = target.capacity - confirmedCount(target.id) - activeHoldCount(target.id);
      if (available < booking.seat_count) return { ok: false as const, error: "The replacement event does not have enough places for this group." };

      const paid = booking.order_id
        ? get<{ amount: number }>(
            `SELECT COALESCE(SUM(p.amount_cents - COALESCE((SELECT SUM(r.amount_cents) FROM refunds r WHERE r.payment_id = p.id), 0)), 0) AS amount
             FROM payments p WHERE p.order_id = ? AND p.status IN ('succeeded','refunded_part')`, booking.order_id
          )?.amount ?? 0
        : 0;
      const replacementPriceCents = target.price_cents * booking.seat_count;
      const refundDueCents = Math.max(0, paid - replacementPriceCents);
      const adjustmentPaidCents = Math.max(0, replacementPriceCents - paid);
      let adjustmentOrderId: number | null = null;
      if (adjustmentPaidCents > 0) {
        if (!input.paymentMethod) return { ok: false as const, error: `Record the additional ${fmtEuro(adjustmentPaidCents)} payment before transferring this booking.` };
        const ref = `YA-XFER-${booking.id}-${Date.now()}`;
        const order = run(
          `INSERT INTO orders (ref, customer_id, status, subtotal_cents, total_cents, offline, checkout_mode, paid_at, notes_admin, created_at, updated_at)
           VALUES (?,?,'paid',?,?,1,'offline',?,?,?,?)`,
          ref, booking.customer_id, adjustmentPaidCents, adjustmentPaidCents, now, input.note ?? "Event transfer price difference", now, now
        );
        adjustmentOrderId = Number(order.lastInsertRowid);
        const item = run(
          `INSERT INTO order_items (order_id, kind, occurrence_id, description, qty, unit_cents, total_cents) VALUES (?,'event_transfer',?,?,?,?,?)`,
          adjustmentOrderId, target.id, `Price difference for event transfer to ${target.kind}`, 1, adjustmentPaidCents, adjustmentPaidCents
        );
        run(
          `INSERT INTO payments (order_id, provider, provider_ref, amount_cents, status, method, note_admin, created_at, updated_at)
           VALUES (?, 'offline', ?, ?, 'succeeded', ?, ?, ?, ?)`,
          adjustmentOrderId, `offline-${ref}`, adjustmentPaidCents, input.paymentMethod, input.note ?? null, now, now
        );
        void item;
      }

      run(
        `UPDATE bookings SET occurrence_id = ?, status = 'confirmed', price_cents = ?, cancelled_at = NULL, cancellation_reason = NULL, updated_at = ? WHERE id = ?`,
        target.id, replacementPriceCents, now, booking.id
      );
      if (booking.order_id) run(`UPDATE orders SET recovery = NULL, updated_at = ? WHERE id = ? AND recovery = 'refund_required'`, now, booking.order_id);
      run(`DELETE FROM booking_attendees WHERE booking_id = ?`, booking.id);
      names.forEach((name, index) => run(`INSERT INTO booking_attendees (booking_id, name, sort) VALUES (?,?,?)`, booking.id, name, index));
      const transfer = run(
        `INSERT INTO event_transfers (booking_id, from_occurrence_id, to_occurrence_id, previous_paid_cents, replacement_price_cents, refund_due_cents, settlement_status, adjustment_order_id, actor, created_at, settled_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        booking.id, booking.occurrence_id, target.id, paid, replacementPriceCents, refundDueCents,
        refundDueCents > 0 ? "refund_due" : "settled", adjustmentOrderId, input.actor, now, refundDueCents > 0 ? null : now
      );
      audit("event.booking_transferred", {
        actorType: "admin", actor: input.actor, entityType: "booking", entityId: booking.id,
        detail: { fromOccurrenceId: booking.occurrence_id, toOccurrenceId: target.id, seatCount: booking.seat_count, paid, replacementPriceCents, refundDueCents, adjustmentPaidCents },
      });
      return { ok: true as const, transferId: Number(transfer.lastInsertRowid), refundDueCents, adjustmentPaidCents };
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not transfer this booking." };
  }
}

function getSettingsSync() {
  // settings read inside sync transactions
  const rows = all<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const map: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      map[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore */
    }
  }
  return { cancellation_cutoff_hours: (map.cancellation_cutoff_hours as number) ?? 24 };
}

// ---------------- Refunds ----------------

export type RefundOutcome =
  | { ok: true; status: "refunded" | "refunded_part"; remainingCents: number; stripeRefundId?: string }
  | { ok: false; error: string };

/**
 * Record a refund against a payment with real accounting:
 * remaining_refundable = amount_cents - successful refunds already recorded.
 * Rejects invalid/over-refunds; persists the real Stripe refund id when given.
 */
export function recordRefund(
  paymentId: number,
  amountCents: number,
  actor: string,
  reason: string,
  opts: { provider?: string; providerRef?: string | null; eventTransferId?: number } = {}
): RefundOutcome {
  return tx(() => {
    const payment = get<{ id: number; order_id: number | null; amount_cents: number; status: string }>(
      `SELECT * FROM payments WHERE id = ?`, paymentId
    );
    if (!payment) return { ok: false as const, error: "Payment not found." };
    if (!["succeeded", "refunded_part"].includes(payment.status)) {
      return { ok: false as const, error: `This payment is ${payment.status} and cannot be refunded.` };
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return { ok: false as const, error: "Enter a refund amount greater than zero." };
    }
    const transfer = opts.eventTransferId
      ? get<{ id: number; refund_due_cents: number; settlement_status: string }>(
          `SELECT t.id, t.refund_due_cents, t.settlement_status FROM event_transfers t
           JOIN bookings b ON b.id = t.booking_id WHERE t.id = ? AND b.order_id = ?`,
          opts.eventTransferId, payment.order_id
        )
      : null;
    if (opts.eventTransferId && (!transfer || transfer.settlement_status !== "refund_due" || amountCents > transfer.refund_due_cents)) {
      return { ok: false as const, error: "This refund does not match an outstanding event-transfer balance." };
    }
    const refundedSoFar = get<{ r: number }>(
      `SELECT COALESCE(SUM(amount_cents),0) AS r FROM refunds WHERE payment_id = ?`, paymentId
    )!.r;
    const remaining = payment.amount_cents - refundedSoFar;
    if (amountCents > remaining) {
      return { ok: false as const, error: `Only ${(remaining / 100).toFixed(2)} of this payment remains refundable.` };
    }
    run(
      `INSERT INTO refunds (payment_id, amount_cents, provider, provider_ref, reason, actor) VALUES (?,?,?,?,?,?)`,
      paymentId, amountCents, opts.provider ?? "manual", opts.providerRef ?? null, reason, actor
    );
    const newRemaining = remaining - amountCents;
    const status = newRemaining === 0 ? "refunded" : "refunded_part";
    run(`UPDATE payments SET status = ?, updated_at = ? WHERE id = ?`, status, nowIso(), paymentId);
    if (transfer) {
      const remainingDue = transfer.refund_due_cents - amountCents;
      run(
        `UPDATE event_transfers SET refund_due_cents = ?, settlement_status = ?, settled_at = ? WHERE id = ?`,
        remainingDue, remainingDue === 0 ? "settled" : "refund_due", remainingDue === 0 ? nowIso() : null, transfer.id
      );
    }
    audit("payment.refund_recorded", {
      actorType: "admin", actor, entityType: "payment", entityId: paymentId,
      detail: { amount: amountCents, status, remaining: newRemaining, reason },
    });
    return { ok: true as const, status, remainingCents: newRemaining, stripeRefundId: opts.providerRef ?? undefined };
  });
}

/** How much of a payment is still refundable (for the admin UI). */
export function remainingRefundable(paymentId: number): number {
  const payment = get<{ amount_cents: number; status: string }>(`SELECT amount_cents, status FROM payments WHERE id = ?`, paymentId);
  if (!payment || !["succeeded", "refunded_part"].includes(payment.status)) return 0;
  const refunded = get<{ r: number }>(`SELECT COALESCE(SUM(amount_cents),0) AS r FROM refunds WHERE payment_id = ?`, paymentId)!.r;
  return Math.max(0, payment.amount_cents - refunded);
}

function optsNoEmail(): boolean {
  return process.env.SUPPRESS_CUSTOMER_EMAILS === "1";
}

// ---------------- Waitlist ----------------

export async function joinWaitlist(occurrenceId: number, customerId: number, phone?: string | null): Promise<{ ok: boolean; error?: string }> {
  const occ = get<{ id: number; waitlist_enabled: number; capacity: number; title: string }>(`SELECT * FROM class_occurrences WHERE id = ?`, occurrenceId);
  if (!occ) return { ok: false, error: "Class not found" };
  const remaining = occ.capacity - confirmedCount(occurrenceId) - activeHoldCount(occurrenceId);
  if (remaining > 0) return { ok: false, error: "There are still spaces - book directly instead." };
  if (phone && phone.replace(/[^0-9]/g, "").length >= 7) {
    run(`UPDATE customers SET phone = COALESCE(phone, ?), updated_at = ? WHERE id = ?`, phone.trim(), nowIso(), customerId);
  }
  const existing = get(`SELECT id FROM waitlist_entries WHERE occurrence_id = ? AND customer_id = ? AND status IN ('waiting','offered')`, occurrenceId, customerId);
  if (existing) return { ok: true };
  const maxPos = get<{ p: number }>(`SELECT COALESCE(MAX(position),0) AS p FROM waitlist_entries WHERE occurrence_id = ?`, occurrenceId)!;
  run(`INSERT INTO waitlist_entries (occurrence_id, customer_id, status, position, created_at, updated_at) VALUES (?,?, 'waiting', ?, ?, ?)`,
    occurrenceId, customerId, maxPos.p + 1, nowIso(), nowIso());
  const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, customerId);
  const settings = await getSettings();
  if (customer) {
    await sendTemplate("waitlist_confirmation", customer.email, {
      customer_name: customer.name ?? "there",
      class_title: occ.title,
    }, { relatedType: "occurrence", relatedId: occurrenceId });
  }
  void settings;
  return { ok: true };
}

export async function offerNextWaitlistSeat(occurrenceId: number): Promise<boolean> {
  const occ = get<{ id: number; waitlist_enabled: number; capacity: number; title: string; starts_at: string; status: string }>(`SELECT * FROM class_occurrences WHERE id = ?`, occurrenceId);
  // a cancelled class never promotes anyone
  if (!occ || !occ.waitlist_enabled || occ.status !== "scheduled") return false;
  const remaining = occ.capacity - confirmedCount(occurrenceId) - activeHoldCount(occurrenceId);
  if (remaining < 1) return false;
  const next = get<{ id: number; customer_id: number }>(
    `SELECT id, customer_id FROM waitlist_entries WHERE occurrence_id = ? AND status = 'waiting' ORDER BY position ASC LIMIT 1`,
    occurrenceId
  );
  if (!next) return false;
  const settings = await getSettings();
  const expires = new Date(Date.now() + settings.waitlist_offer_hours * 3600 * 1000).toISOString();
  const token = crypto.randomUUID().replace(/-/g, "");
  run(`UPDATE waitlist_entries SET status = 'offered', offered_at = ?, offer_expires_at = ?, offer_token = ?, updated_at = ? WHERE id = ?`,
    nowIso(), expires, token, nowIso(), next.id);
  const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, next.customer_id);
  if (customer) {
    await sendTemplate("waitlist_offer", customer.email, {
      customer_name: customer.name ?? "there",
      class_title: occ.title,
      claim_url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/book?offer=${token}`,
      expiry_hours: String(settings.waitlist_offer_hours),
    }, { relatedType: "occurrence", relatedId: occurrenceId });
  }
  return true;
}

export function expireWaitlistOffers(): void {
  const rows = all<{ id: number; occurrence_id: number }>(
    `SELECT id, occurrence_id FROM waitlist_entries WHERE status = 'offered' AND offer_expires_at <= ?`, nowIso()
  );
  for (const r of rows) {
    run(`UPDATE waitlist_entries SET status = 'expired', updated_at = ? WHERE id = ?`, nowIso(), r.id);
    void offerNextWaitlistSeat(r.occurrence_id);
  }
}

export async function claimWaitlistOffer(token: string, customerId: number): Promise<{ ok: boolean; occurrenceId?: number; error?: string }> {
  const entry = get<{ id: number; occurrence_id: number; status: string; customer_id: number; offer_expires_at: string }>(
    `SELECT * FROM waitlist_entries WHERE offer_token = ?`, token
  );
  if (!entry || entry.customer_id !== customerId) return { ok: false, error: "This offer link is not valid." };
  if (entry.status !== "offered") return { ok: false, error: "This offer is no longer active." };
  if (entry.offer_expires_at < nowIso()) return { ok: false, error: "This offer has expired." };
  return { ok: true, occurrenceId: entry.occurrence_id };
}

/** Manual/admin booking (phone, WhatsApp, in-person). Records an offline payment when requested. */
export async function adminCreateBooking(input: {
  occurrenceId: number;
  email: string;
  name: string;
  phone?: string | null;
  paymentMethod: "recorded" | "cash" | "transfer" | "complimentary"; // "recorded" = already paid externally, recorded by Anne
  amountCents?: number | null;
  noteAdmin?: string | null;
  actor: string;
}): Promise<{ ok: boolean; bookingId?: number; error?: string }> {
  const occ = get<{ id: number; title: string; starts_at: string; ends_at: string; capacity: number; status: string; publication_status: string; series_publication_status: string | null; series_id: number | null; price_override_cents: number | null; booking_close_at: string | null }>(
    `SELECT o.*, s.publication_status AS series_publication_status FROM class_occurrences o LEFT JOIN class_series s ON s.id = o.series_id WHERE o.id = ?`, input.occurrenceId
  );
  if (!occ) return { ok: false, error: "Class not found" };
  if (occ.publication_status !== "published" || (occ.series_id && occ.series_publication_status !== "published")) {
    return { ok: false, error: "This class is still a draft and cannot be booked." };
  }
  if (occ.status !== "scheduled") return { ok: false, error: "This class is cancelled." };
  const customerId = upsertCustomer({ email: input.email, name: input.name, phone: input.phone ?? null });
  const now = nowIso();
  const dropInCents = await getDropInPriceCents();

  try {
    const bookingId = tx(() => {
      const remaining = occ.capacity - confirmedCount(occ.id) - activeHoldCount(occ.id);
      if (remaining < 1) throw new Error("Class is full");
      const res = run(
        `INSERT OR IGNORE INTO bookings (occurrence_id, customer_id, status, source, price_cents, notes_admin, created_at, updated_at)
         VALUES (?,?, 'confirmed', 'admin', ?, ?, ?, ?)`,
        occ.id, customerId, input.paymentMethod === "complimentary" ? 0 : input.amountCents ?? occ.price_override_cents ?? dropInCents,
        input.noteAdmin ?? null, now, now
      );
      const bookingId = Number(res.lastInsertRowid);
      if (bookingId === 0) throw new Error("This person is already booked into this class");
      // EVERY manual booking gets a paid order + payment record, so the books
      // always explain why a place is marked as paid (method recorded on the payment).
      const amount = input.paymentMethod === "complimentary" ? 0 : input.amountCents ?? occ.price_override_cents ?? dropInCents;
      const oRes = run(
        `INSERT INTO orders (ref, customer_id, status, subtotal_cents, discount_cents, total_cents, offline, checkout_mode, paid_at, created_at, updated_at)
         VALUES (?,?, 'paid', ?, 0, ?, 1, 'offline', ?, ?, ?)`,
        generateRef(), customerId, amount, amount, now, now, now
      );
      const orderId = Number(oRes.lastInsertRowid);
      run(`INSERT INTO order_items (order_id, kind, occurrence_id, description, qty, unit_cents, total_cents) VALUES (?,?,?,?,?,?,?)`,
        orderId, "class", occ.id, occ.title, 1, amount, amount);
      if (amount > 0) {
        run(`INSERT INTO payments (order_id, provider, provider_ref, amount_cents, status, method, note_admin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
          orderId, "offline", `offline-${orderId}`, amount, "succeeded", input.paymentMethod, input.noteAdmin ?? null, now, now);
      }
      run(`UPDATE bookings SET order_id = ? WHERE id = ?`, orderId, bookingId);
      audit("booking.manual_created", { actorType: "admin", actor: input.actor, entityType: "booking", entityId: bookingId, detail: { occurrence: occ.id, payment: input.paymentMethod } });
      return bookingId;
    });

    const settings = await getSettings();
    const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, customerId);
    if (customer) {
      await sendTemplate("booking_confirmation", customer.email, {
        customer_name: customer.name ?? "there",
        class_details_html: `<p style="margin:0 0 12px;"><strong>${escapeHtml(occ.title)}</strong><br>${fmtDateTime(occ.starts_at, occ.ends_at, settings.timezone)}</p>`,
        total: input.paymentMethod === "cash" ? "Pay at class" : input.paymentMethod === "transfer" ? "Bank transfer" : input.paymentMethod === "complimentary" ? "Complimentary" : input.paymentMethod === "recorded" ? "Paid (recorded by Anne)" : "",
        booking_url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/account`,
        what_to_bring: "Comfortable clothes and water.",
      }, { relatedType: "booking", relatedId: bookingId });
    }
    return { ok: true, bookingId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Manual enrollment into a published whole block or bundle, reserved atomically across every date. */
export async function adminCreateBlockBooking(input: {
  blockId?: number | null;
  bundleId?: number | null;
  attendeeNames?: string[];
  email: string;
  name: string;
  phone?: string | null;
  paymentMethod: "recorded" | "cash" | "transfer" | "complimentary";
  amountCents?: number | null;
  noteAdmin?: string | null;
  actor: string;
}): Promise<{ ok: boolean; orderId?: number; bookingCount?: number; seatCount?: number; eventBooking?: boolean; error?: string }> {
  if (!!input.blockId === !!input.bundleId) return { ok: false, error: "Choose one block or bundle." };

  const { getBlock, getBundleView, blockDates, bundleOccurrences, effectivePriceCents } = await import("./blocks");
  const now = nowIso();
  let occurrenceIds: number[] = [];
  let totalCents = 0;
  let itemKind: "block" | "bundle";
  let description = "";
  let seatCount = 1;
  let attendeeNames: string[] = [];
  let eventBooking = false;
  let eventDateRange: { start_date: string; end_date: string } | null = null;

  if (input.blockId) {
    const block = getBlock(input.blockId);
    if (!block || !block.active || block.publication_status !== "published") {
      return { ok: false, error: "This block is not available for booking." };
    }
    if (block.kind === "workshop" || block.kind === "retreat") {
      eventBooking = true;
      eventDateRange = { start_date: block.start_date, end_date: block.end_date };
      attendeeNames = (input.attendeeNames?.length ? input.attendeeNames : [input.name]).map((name) => name.trim()).filter(Boolean);
      if (attendeeNames.length === 0 || attendeeNames.length > 20) return { ok: false, error: "Enter a name for each attendee (up to 20 people)." };
      seatCount = attendeeNames.length;
    }
    occurrenceIds = blockDates(block)
      .filter((date) => date.status === "scheduled" && date.startsAt > now)
      .map((date) => date.occurrenceId);
    totalCents = effectivePriceCents(block, now) * seatCount;
    itemKind = "block";
    description = `${block.name} block`;
  } else {
    const bundle = await getBundleView(input.bundleId!);
    if (!bundle || !bundle.active || !bundle.published) return { ok: false, error: "This bundle is not available for booking." };
    occurrenceIds = bundleOccurrences(input.bundleId!)
      .flatMap((part) => part.occurrenceIds)
      .filter((id, index, ids) => ids.indexOf(id) === index);
    totalCents = bundle.price_cents;
    itemKind = "bundle";
    description = `${bundle.name} bundle`;
  }

  const dateRows = occurrenceIds.length
    ? all<{ id: number; title: string; starts_at: string; ends_at: string; capacity: number; status: string; publication_status: string }>(
        `SELECT id, title, starts_at, ends_at, capacity, status, publication_status FROM class_occurrences
         WHERE id IN (${occurrenceIds.map(() => "?").join(",")}) AND starts_at > ? ORDER BY starts_at`,
        ...occurrenceIds, now
      )
    : [];
  if (dateRows.length === 0) return { ok: false, error: "This offering has no upcoming dates." };
  if (dateRows.length !== occurrenceIds.length || dateRows.some((date) => date.status !== "scheduled")) {
    return { ok: false, error: "One of the offering dates is no longer available." };
  }

  const customerId = upsertCustomer({ email: input.email, name: input.name, phone: input.phone ?? null });
  const duplicate = get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM bookings WHERE customer_id = ? AND status IN ('confirmed','attended')
     AND occurrence_id IN (${dateRows.map(() => "?").join(",")})`,
    customerId, ...dateRows.map((date) => date.id)
  )!;
  if (duplicate.count > 0) return { ok: false, error: "This person is already booked into one or more dates in this offering." };

  const amount = input.paymentMethod === "complimentary" ? 0 : input.amountCents ?? totalCents;
  const shares = distributeCents(amount, dateRows.length);
  const ref = generateRef();
  let orderId = 0;
  try {
    orderId = tx(() => {
      for (const date of dateRows) {
        const remaining = date.capacity - confirmedCount(date.id) - activeHoldCount(date.id);
        if (remaining < seatCount) throw new Error(`FULL:${date.id}`);
      }
      const order = run(
        `INSERT INTO orders (ref, customer_id, status, subtotal_cents, discount_cents, total_cents, offline, checkout_mode, paid_at, notes_admin, created_at, updated_at)
         VALUES (?,?,'paid',?,0,?,1,'offline',?,?,?,?)`,
        ref, customerId, amount, amount, now, input.noteAdmin ?? null, now, now
      );
      const newOrderId = Number(order.lastInsertRowid);
      const item = run(
        `INSERT INTO order_items (order_id, kind, description, qty, unit_cents, total_cents) VALUES (?,?,?,?,?,?)`,
        newOrderId, itemKind, description, seatCount, seatCount ? Math.floor(amount / seatCount) : amount, amount
      );
      for (const [index, date] of dateRows.entries()) {
        const booking = run(
          `INSERT OR IGNORE INTO bookings (occurrence_id, customer_id, order_id, order_item_id, status, seat_count, source, price_cents, notes_admin, created_at, updated_at)
           VALUES (?,?,?,?,'confirmed',?,'admin',?,?,?,?)`,
          date.id, customerId, newOrderId, Number(item.lastInsertRowid), seatCount, shares[index], input.noteAdmin ?? null, now, now
        );
        if (booking.changes !== 1) throw new Error("This person is already booked into one or more dates in this offering.");
        attendeeNames.forEach((attendeeName, attendeeIndex) => {
          run(`INSERT INTO booking_attendees (booking_id, name, sort) VALUES (?,?,?)`, Number(booking.lastInsertRowid), attendeeName, attendeeIndex);
        });
      }
      if (amount > 0) {
        run(
          `INSERT INTO payments (order_id, provider, provider_ref, amount_cents, status, method, note_admin, created_at, updated_at)
           VALUES (?, 'offline', ?, ?, 'succeeded', ?, ?, ?, ?)`,
          newOrderId, `offline-${newOrderId}`, amount, input.paymentMethod, input.noteAdmin ?? null, now, now
        );
      }
      audit("booking.manual_block_created", {
        actorType: "admin", actor: input.actor, entityType: itemKind, entityId: newOrderId,
        detail: { description, dates: dateRows.length, seatCount, amount, paymentMethod: input.paymentMethod },
      });
      return newOrderId;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("FULL:")) return { ok: false, error: "One of the dates in this offering is full. No booking was added." };
    return { ok: false, error: message };
  }

  const settings = await getSettings();
  const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, customerId);
  if (customer) {
    const eventDates = eventDateRange
      ? `${fmtDate(`${eventDateRange.start_date}T12:00:00.000Z`, settings.timezone, true)} – ${fmtDate(`${eventDateRange.end_date}T12:00:00.000Z`, settings.timezone, true)}`
      : null;
    const attendeesLine = attendeeNames.length ? `<br>Attendees: ${attendeeNames.map(escapeHtml).join(", ")}` : "";
    const detailsHtml = dateRows.map((date) =>
      `<p style="margin:0 0 12px;"><strong>${escapeHtml(date.title)}</strong><br>${eventDates ?? fmtDateTime(date.starts_at, date.ends_at, settings.timezone)}${attendeesLine}</p>`
    ).join("");
    await sendTemplate("booking_confirmation", customer.email, {
      customer_name: customer.name ?? "there",
      class_details_html: detailsHtml,
      total: input.paymentMethod === "cash" ? "Pay at class" : input.paymentMethod === "transfer" ? "Bank transfer" : input.paymentMethod === "complimentary" ? "Complimentary" : "Paid (recorded by the organiser)",
      booking_url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/account`,
      what_to_bring: "Comfortable clothes and water.",
    }, { relatedType: "order", relatedId: orderId });
  }
  return { ok: true, orderId, bookingCount: dateRows.length, seatCount, eventBooking };
}
