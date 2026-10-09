import { test } from "node:test";
import assert from "node:assert/strict";
import { quote, type PricingInput, type PricingSeat } from "@/lib/pricing";

const NOW = "2026-09-27T12:00:00.000Z";
const seat = (id: number, dateKey: string, price = 1200, type = 1): PricingSeat => ({
  occurrenceId: id,
  title: `Class ${id}`,
  startsAt: `${dateKey}T18:30:00.000Z`,
  dateKey,
  priceCents: price,
  classTypeId: type,
});

const RULE = { name: "Multi-date rate", minDates: 2, maxDates: 4, perClassCents: 1100, active: true };
const PASS5 = { productId: 11, name: "5-class flex pass", priceCents: 5000, credits: 5, validityWeeks: 8 };
const PASS10 = { productId: 12, name: "10-class flex pass", priceCents: 9500, credits: 10, validityWeeks: 16 };
const INTRO = { productId: 13, name: "Intro pass", priceCents: 3000, credits: 3, validityWeeks: 4 };

function base(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    seats: [],
    dropInCents: 1200,
    discountRule: RULE,
    coupon: null,
    passes: [],
    membership: null,
    passProducts: [PASS5, PASS10],
    introProduct: INTRO,
    isNewCustomer: false,
    now: NOW,
    ...overrides,
  };
}

test("one class prices at the drop-in rate", () => {
  const r = quote(base({ seats: [seat(1, "2026-10-06")] }));
  assert.equal(r.totalCents, 1200);
  assert.equal(r.chosen.kind, "drop_in");
  assert.equal(r.discountCents, 0);
});

test("two distinct dates get the multi-date rate automatically", () => {
  const r = quote(base({ seats: [seat(1, "2026-10-06"), seat(2, "2026-10-08")] }));
  assert.equal(r.totalCents, 2200);
  assert.equal(r.chosen.kind, "multi_date");
  assert.equal(r.discountCents, 200);
  assert.ok(r.chosen.explanation.includes("2"));
});

test("three distinct dates split cents without losing a cent", () => {
  const r = quote(base({ seats: [seat(1, "2026-10-06"), seat(2, "2026-10-08"), seat(3, "2026-10-13")] }));
  assert.equal(r.totalCents, 3300);
  const lineSum = r.lines.filter((l) => l.kind === "class").reduce((s, l) => s + l.totalCents, 0);
  assert.equal(lineSum, 3300);
});

test("two seats on the SAME date do not count as a multi-date deal", () => {
  // (possible when a class has two sessions on one calendar date)
  const r = quote(base({ seats: [seat(1, "2026-10-06", 1200, 1), seat(2, "2026-10-06", 1200, 2)] }));
  assert.equal(r.totalCents, 2400);
  assert.equal(r.chosen.kind, "drop_in");
});

test("five distinct dates exceed the multi-date max and a pass wins instead", () => {
  const seats = Array.from({ length: 5 }, (_, i) => seat(i + 1, `2026-10-0${i + 1}`));
  const r = quote(base({ seats }));
  assert.equal(r.totalCents, 5000); // 5-pass beats €60 drop-in
  assert.equal(r.chosen.kind, "pass_purchase");
});

test("ten classes choose the 10-class pass", () => {
  const seats = Array.from({ length: 10 }, (_, i) => seat(i + 1, `2026-11-${String(i + 1).padStart(2, "0")}`));
  const r = quote(base({ seats }));
  assert.equal(r.totalCents, 9500);
  assert.equal(r.chosen.kind, "pass_purchase");
});

test("pass purchase with leftover credits prices remainder seats at drop-in", () => {
  // 7 seats: 5-pass (€50) covers 5, remaining 2 at €12 = €74 total
  const seats = Array.from({ length: 7 }, (_, i) => seat(i + 1, `2026-10-${String(i + 6).padStart(2, "0")}`));
  const r = quote(base({ seats }));
  assert.equal(r.totalCents, 7400);
  const coveredByPass = r.seats.filter((s) => s.source === "pass").length;
  assert.equal(coveredByPass, 5);
});

test("intro pass applies for new customers booking up to 3 classes", () => {
  const seats = [seat(1, "2026-10-06"), seat(2, "2026-10-08"), seat(3, "2026-10-13")];
  const r = quote(base({ seats, isNewCustomer: true }));
  assert.equal(r.totalCents, 3000);
  assert.equal(r.chosen.kind, "intro_pass");
});

test("intro pass is NOT offered to existing customers", () => {
  const seats = [seat(1, "2026-10-06"), seat(2, "2026-10-08"), seat(3, "2026-10-13")];
  const r = quote(base({ seats, isNewCustomer: false }));
  assert.equal(r.totalCents, 3300);
  assert.equal(r.chosen.kind, "multi_date");
});

test("coupon applies to drop-in total and wins when better than multi-date", () => {
  const seats = [seat(1, "2026-10-06"), seat(2, "2026-10-08")];
  const coupon = { couponId: 1, code: "WELCOME15", kind: "percent" as const, value: 15, minTotalCents: 0 };
  const r = quote(base({ seats, coupon }));
  // drop-in 2400, -15% = 2040 vs multi-date 2200 → coupon best
  assert.equal(r.totalCents, 2040);
  assert.equal(r.chosen.kind, "coupon");
});

test("coupon does NOT stack with the multi-date discount", () => {
  const seats = [seat(1, "2026-10-06"), seat(2, "2026-10-08")];
  const coupon = { couponId: 1, code: "SMALL", kind: "percent" as const, value: 5, minTotalCents: 0 };
  const r = quote(base({ seats, coupon }));
  // coupon total 2280 > multi-date 2200 → multi-date chosen, no stacking
  assert.equal(r.totalCents, 2200);
  assert.equal(r.chosen.kind, "multi_date");
});

test("100% coupon never produces a negative total", () => {
  const coupon = { couponId: 2, code: "FREE", kind: "percent" as const, value: 100, minTotalCents: 0 };
  const r = quote(base({ seats: [seat(1, "2026-10-06")], coupon }));
  assert.equal(r.totalCents, 0);
});

test("fixed coupon is capped at the basket total", () => {
  const coupon = { couponId: 3, code: "BIG", kind: "fixed" as const, value: 9999, minTotalCents: 0 };
  const r = quote(base({ seats: [seat(1, "2026-10-06")], coupon }));
  assert.equal(r.totalCents, 0);
});

test("expired pass credits are not used", () => {
  const r = quote(
    base({
      seats: [seat(1, "2026-10-06")],
      passes: [{ passId: 7, creditsLeft: 2, expiresAt: "2026-09-01T00:00:00.000Z", label: "Old pass" }],
    })
  );
  assert.equal(r.totalCents, 1200); // paid normally
  assert.equal(r.seats[0].source, "paid");
});

test("live pass credits cover seats earliest-expiry first, €0 charged", () => {
  const r = quote(
    base({
      seats: [seat(1, "2026-10-06"), seat(2, "2026-10-08")],
      passes: [
        { passId: 7, creditsLeft: 1, expiresAt: "2026-10-01T00:00:00.000Z", label: "Soon pass" },
        { passId: 8, creditsLeft: 2, expiresAt: "2026-12-01T00:00:00.000Z", label: "Later pass" },
      ],
    })
  );
  assert.equal(r.totalCents, 0);
  assert.equal(r.chosen.kind, "entitlement_only");
  const byId = new Map(r.seats.map((s) => [s.occurrenceId, s]));
  assert.equal(byId.get(1)?.passId, 7); // earliest expiry consumed first
  assert.equal(byId.get(2)?.passId, 8);
});

test("membership covers eligible class types within the period", () => {
  const r = quote(
    base({
      seats: [seat(1, "2026-10-06", 1200, 1), seat(2, "2026-10-08", 1200, 1)],
      membership: { membershipId: 3, label: "Monthly", classTypeIds: [1], periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z" },
    })
  );
  assert.equal(r.totalCents, 0);
  assert.ok(r.seats.every((s) => s.source === "membership"));
});

test("membership excludes classes outside its allowed types", () => {
  const r = quote(
    base({
      seats: [seat(1, "2026-10-06", 1200, 2)], // type 2 not allowed
      membership: { membershipId: 3, label: "Monthly", classTypeIds: [1], periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z" },
    })
  );
  assert.equal(r.totalCents, 1200);
  assert.equal(r.seats[0].source, "paid");
});

test("membership excludes classes outside its period", () => {
  const r = quote(
    base({
      seats: [seat(1, "2026-12-06")],
      membership: { membershipId: 3, label: "Monthly", classTypeIds: null, periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z" },
    })
  );
  assert.equal(r.totalCents, 1200);
});

test("an inactive discount rule falls back to drop-in pricing", () => {
  const r = quote(
    base({ seats: [seat(1, "2026-10-06"), seat(2, "2026-10-08")], discountRule: { ...RULE, active: false } })
  );
  assert.equal(r.totalCents, 2400);
  assert.equal(r.chosen.kind, "drop_in");
});

test("empty basket returns zero", () => {
  const r = quote(base());
  assert.equal(r.totalCents, 0);
  assert.equal(r.chosen.kind, "empty");
});

test("alternatives always show what else was possible", () => {
  const seats = [seat(1, "2026-10-06"), seat(2, "2026-10-08"), seat(3, "2026-10-13"), seat(4, "2026-10-15")];
  const r = quote(base({ seats, isNewCustomer: true }));
  assert.ok(r.alternatives.length >= 2);
  assert.ok(r.alternatives.every((a) => a.totalCents >= 0));
  // chosen is the cheapest
  const cheapest = Math.min(...r.alternatives.map((a) => a.totalCents));
  assert.equal(r.totalCents, cheapest);
});

test("multi-date rate NEVER undercuts custom-priced (workshop) seats", () => {
  // two workshop seats at €80 each: multi-date at €11/class would be absurd
  const seats = [seat(1, "2026-10-06", 8000, 1), seat(2, "2026-10-08", 8000, 1)];
  const r = quote(base({ seats }));
  assert.equal(r.totalCents, 16000);
  assert.equal(r.chosen.kind, "drop_in");
});

test("multi-date rate still applies when ALL seats are standard-priced", () => {
  const seats = [seat(1, "2026-10-06", 1200, 1), seat(2, "2026-10-08", 1200, 1)];
  const r = quote(base({ seats }));
  assert.equal(r.chosen.kind, "multi_date");
  assert.equal(r.totalCents, 2200);
});

test("one custom-priced seat in the basket disables the multi-date rate entirely", () => {
  const seats = [seat(1, "2026-10-06", 1200, 1), seat(2, "2026-10-08", 8000, 1)];
  const r = quote(base({ seats }));
  assert.equal(r.totalCents, 9200); // 1200 + 8000, no multi-date
});
