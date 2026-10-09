/**
 * Pricing engine - pure, deterministic, unit-tested.
 * Takes seats (selected class dates), entitlements and rules; returns the
 * best eligible price structure with a full transparent explanation.
 * All amounts in integer cents.
 */

export type PricingSeat = {
  occurrenceId: number;
  title: string;
  startsAt: string;
  dateKey: string; // local date, for distinct-date counting
  priceCents: number;
  classTypeId: number;
};

export type PassEntitlement = {
  passId: number;
  creditsLeft: number;
  expiresAt: string;
  label: string;
};

export type MembershipEntitlement = {
  membershipId: number;
  classTypeIds: number[] | null; // null = all regular classes
  periodStart: string;
  periodEnd: string;
  label: string;
};

export type PassProduct = {
  productId: number;
  name: string;
  priceCents: number;
  credits: number;
  validityWeeks: number | null;
};

export type CouponInput = {
  couponId: number;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  minTotalCents: number;
};

export type PricingInput = {
  seats: PricingSeat[]; // will be sorted by startsAt
  dropInCents: number; // default per-class price
  discountRule:
    | { name: string; minDates: number; maxDates: number; perClassCents: number; active: boolean }
    | null;
  coupon?: CouponInput | null;
  passes: PassEntitlement[];
  membership: MembershipEntitlement | null;
  passProducts: PassProduct[]; // purchasable passes
  introProduct: PassProduct | null; // new-student intro pass
  isNewCustomer: boolean;
  now: string; // ISO instant for expiry checks
};

export type CoveredSeat = {
  occurrenceId: number;
  source: "pass" | "membership" | "paid";
  passId?: number;
  membershipId?: number;
  priceCents: number; // 0 for covered seats
};

export type PricingLine = {
  kind: "class" | "pass" | "membership" | "entitlement" | "block" | "bundle";
  occurrenceId?: number;
  productId?: number;
  passId?: number;
  membershipId?: number;
  description: string;
  qty: number;
  unitCents: number;
  totalCents: number;
};

export type ChosenStructure = {
  kind:
    | "entitlement_only"
    | "multi_date"
    | "coupon"
    | "intro_pass"
    | "pass_purchase"
    | "drop_in"
    | "block"
    | "bundle"
    | "empty";
  label: string;
  explanation: string;
};

export type PricingResult = {
  seats: CoveredSeat[];
  lines: PricingLine[];
  subtotalCents: number; // drop-in baseline total
  discountCents: number; // vs drop-in baseline
  totalCents: number;
  chosen: ChosenStructure;
  alternatives: { kind: string; label: string; totalCents: number; savedCents: number; note?: string }[];
};

function distribute(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

export function quote(input: PricingInput): PricingResult {
  const seats = [...input.seats].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const baseline = seats.reduce((s, x) => s + x.priceCents, 0);

  if (seats.length === 0) {
    return {
      seats: [],
      lines: [],
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
      chosen: { kind: "empty", label: "No classes selected", explanation: "" },
      alternatives: [],
    };
  }

  // ---- 1. Entitlements (pass credits first - earliest expiry - then membership)
  const covered: CoveredSeat[] = [];
  const lines: PricingLine[] = [];
  const passState = new Map<number, number>();
  for (const p of input.passes) {
    if (p.expiresAt > input.now && p.creditsLeft > 0) passState.set(p.passId, p.creditsLeft);
  }
  const passById = new Map(input.passes.map((p) => [p.passId, p]));

  const membershipCovers = (seat: PricingSeat) => {
    const m = input.membership;
    if (!m) return false;
    if (seat.priceCents !== input.dropInCents) return false; // memberships cover regular classes only
    if (seat.startsAt < m.periodStart || seat.startsAt > m.periodEnd) return false;
    if (m.classTypeIds == null) return true;
    return m.classTypeIds.includes(seat.classTypeId);
  };

  const paidSeats: PricingSeat[] = [];
  for (const seat of seats) {
    let usedPass: number | null = null;
    // earliest-expiring pass with credit
    const candidates = [...passState.entries()]
      .filter(([, credits]) => credits > 0)
      .map(([id]) => id)
      .sort((a, b) => {
        const pa = passById.get(a)!;
        const pb = passById.get(b)!;
        return pa.expiresAt.localeCompare(pb.expiresAt) || a - b;
      });
    if (candidates.length > 0 && seat.priceCents === input.dropInCents) {
      usedPass = candidates[0];
      passState.set(usedPass, passState.get(usedPass)! - 1);
    } else if (membershipCovers(seat)) {
      covered.push({
        occurrenceId: seat.occurrenceId,
        source: "membership",
        membershipId: input.membership!.membershipId,
        priceCents: 0,
      });
      continue;
    } else {
      paidSeats.push(seat);
      covered.push({ occurrenceId: seat.occurrenceId, source: "paid", priceCents: seat.priceCents });
      continue;
    }
    covered.push({ occurrenceId: seat.occurrenceId, source: "pass", passId: usedPass!, priceCents: 0 });
  }

  for (const [passId] of passState) {
    const ent = passById.get(passId)!;
    const used = ent.creditsLeft - passState.get(passId)!;
    if (used > 0) {
      lines.push({
        kind: "entitlement",
        passId,
        description: `${used} credit${used === 1 ? "" : "s"} from ${ent.label}`,
        qty: used,
        unitCents: 0,
        totalCents: 0,
      });
    }
  }
  if (input.membership && covered.some((c) => c.source === "membership")) {
    lines.push({
      kind: "entitlement",
      membershipId: input.membership.membershipId,
      description: `Covered by ${input.membership.label}`,
      qty: covered.filter((c) => c.source === "membership").length,
      unitCents: 0,
      totalCents: 0,
    });
  }

  // ---- 2. Candidates for the paid seats
  const paidCount = paidSeats.length;
  const dropInTotal = paidSeats.reduce((s, x) => s + x.priceCents, 0);
  type Candidate = { kind: ChosenStructure["kind"]; label: string; explanation: string; total: number; productId?: number };
  const candidates: Candidate[] = [
    { kind: "drop_in", label: "Pay per class", explanation: "Standard drop-in price per class.", total: dropInTotal },
  ];

  const rule = input.discountRule;
  const distinctDates = new Set(paidSeats.map((s) => s.dateKey)).size;
  // The multi-date rate assumes the standard drop-in price - it must never
  // silently undercut custom-priced seats (workshops, priced blocks, etc.).
  const allStandardPrice = paidSeats.every((s) => s.priceCents === input.dropInCents);
  if (rule && rule.active && allStandardPrice && distinctDates >= rule.minDates && distinctDates <= rule.maxDates && paidCount >= rule.minDates) {
    const total = paidCount * rule.perClassCents;
    if (total < dropInTotal) {
      candidates.push({
        kind: "multi_date",
        label: rule.name,
        explanation: `${paidCount} class${paidCount === 1 ? "" : "es"} on ${distinctDates} different date${distinctDates === 1 ? "" : "s"} at the multi-date rate of €${(rule.perClassCents / 100).toFixed(2)} each.`,
        total,
      });
    }
  }

  if (input.coupon) {
    const c = input.coupon;
    if (dropInTotal >= c.minTotalCents) {
      const off = c.kind === "percent" ? Math.round((dropInTotal * c.value) / 100) : Math.min(c.value, dropInTotal);
      const total = Math.max(0, dropInTotal - off);
      candidates.push({
        kind: "coupon",
        label: `Coupon ${c.code}`,
        explanation: `Coupon ${c.code} applied to the drop-in price.`,
        total,
      });
    }
  }

  const purchaseCandidate = (p: PassProduct, kind: "intro_pass" | "pass_purchase"): Candidate => {
    // pass covers the first `credits` paid seats; the remainder stay drop-in
    const remainder = paidSeats.slice(p.credits);
    const total = p.priceCents + remainder.reduce((s, x) => s + x.priceCents, 0);
    const coveredN = Math.min(p.credits, paidCount);
    return {
      kind,
      label: `${p.name} (${coveredN} class${coveredN === 1 ? "" : "es"} covered)`,
      explanation: `Buy ${p.name} now - covers ${coveredN} of your ${paidCount} selected class${paidCount === 1 ? "" : "es"}${remainder.length ? `, plus ${remainder.length} at the drop-in rate` : ""}. Any leftover credits stay on your pass.`,
      total,
      productId: p.productId,
    };
  };

  if (allStandardPrice) {
    if (input.isNewCustomer && input.introProduct && paidCount <= input.introProduct.credits) {
      candidates.push(purchaseCandidate(input.introProduct, "intro_pass"));
    }
    for (const p of input.passProducts) {
      if (p.credits >= 2) candidates.push(purchaseCandidate(p, "pass_purchase"));
    }
  }

  candidates.sort((a, b) => a.total - b.total || rank(a.kind) - rank(b.kind));
  function rank(k: ChosenStructure["kind"]): number {
    return { multi_date: 0, coupon: 1, intro_pass: 2, pass_purchase: 3, drop_in: 4, entitlement_only: 5, block: 6, bundle: 7, empty: 8 }[k];
  }
  const best = candidates[0];

  // ---- 3. Build lines for the paid seats
  if (best.total > 0 || best.kind === "drop_in") {
    if (best.kind === "pass_purchase" || best.kind === "intro_pass") {
      const p =
        best.kind === "intro_pass"
          ? input.introProduct!
          : input.passProducts.find((x) => x.productId === best.productId)!;
      const units = distribute(p.priceCents, Math.min(p.credits, paidCount));
      paidSeats.slice(0, units.length).forEach((seat, i) => {
        const c = covered.find((x) => x.occurrenceId === seat.occurrenceId)!;
        c.priceCents = units[i];
        c.source = "pass";
        lines.push({
          kind: "class",
          occurrenceId: seat.occurrenceId,
          description: seat.title,
          qty: 1,
          unitCents: units[i],
          totalCents: units[i],
        });
      });
      lines.push({
        kind: "pass",
        productId: p.productId,
        description: `${p.name} - credits used today + any remainder for future classes`,
        qty: 1,
        unitCents: p.priceCents,
        totalCents: p.priceCents,
      });
      for (const seat of paidSeats.slice(p.credits)) {
        covered.find((c) => c.occurrenceId === seat.occurrenceId)!.priceCents = seat.priceCents;
        lines.push({
          kind: "class",
          occurrenceId: seat.occurrenceId,
          description: seat.title,
          qty: 1,
          unitCents: seat.priceCents,
          totalCents: seat.priceCents,
        });
      }
    } else {
      const units = distribute(best.total, paidCount);
      paidSeats.forEach((seat, i) => {
        covered.find((c) => c.occurrenceId === seat.occurrenceId)!.priceCents = units[i];
        lines.push({
          kind: "class",
          occurrenceId: seat.occurrenceId,
          description: seat.title,
          qty: 1,
          unitCents: units[i],
          totalCents: units[i],
        });
      });
    }
  }

  // Pass lines must come after class lines in a stable order; reorder: classes, pass, entitlements
  const classLines = lines.filter((l) => l.kind === "class");
  const passLines = lines.filter((l) => l.kind === "pass");
  const entLines = lines.filter((l) => l.kind === "entitlement");
  const orderedLines = [...classLines, ...passLines, ...entLines];

  const alternatives = candidates.map((c) => ({
    kind: c.kind,
    label: c.label,
    totalCents: c.total,
    savedCents: Math.max(0, dropInTotal - c.total),
    note: c.explanation,
  }));

  const total = Math.max(0, best.total);
  return {
    seats: covered,
    lines: orderedLines,
    subtotalCents: baseline,
    discountCents: Math.max(0, baseline - total),
    totalCents: total,
    chosen: {
      kind: paidCount === 0 ? "entitlement_only" : best.kind,
      label: paidCount === 0 ? "Covered by your pass / membership" : best.label,
      explanation: paidCount === 0 ? "All selected classes are covered by an existing pass or membership." : best.explanation,
    },
    alternatives,
  };
}
