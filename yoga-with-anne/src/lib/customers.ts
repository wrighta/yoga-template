import { all, get, run, nowIso } from "@/db";
import { zonedToUtc } from "./tz";

export type Customer = {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  marketing_consent: number;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function upsertCustomer(input: {
  email: string;
  name?: string | null;
  phone?: string | null;
  marketingConsent?: boolean;
  consentSource?: string;
}): number {
  const email = normalizeEmail(input.email);
  const existing = get<Customer>("SELECT * FROM customers WHERE email = ?", email);
  const now = nowIso();
  if (existing) {
    run(
      `UPDATE customers SET
         name = COALESCE(?, name),
         phone = COALESCE(?, phone),
         marketing_consent = CASE WHEN ? THEN 1 ELSE marketing_consent END,
         consent_source = CASE WHEN ? THEN ? ELSE consent_source END,
         consent_at = CASE WHEN ? THEN ? ELSE consent_at END,
         updated_at = ?
       WHERE id = ?`,
      input.name ?? null,
      input.phone ?? null,
      input.marketingConsent === true ? 1 : 0,
      input.marketingConsent === true ? 1 : 0,
      input.consentSource ?? "booking",
      input.marketingConsent === true ? 1 : 0,
      now,
      now,
      existing.id
    );
    return existing.id;
  }
  const res = run(
    `INSERT INTO customers (email, name, phone, marketing_consent, consent_source, consent_version, consent_at, created_at, updated_at)
     VALUES (?,?,?,?,?, 'v1', ?, ?, ?)`,
    email,
    input.name ?? null,
    input.phone ?? null,
    input.marketingConsent === true ? 1 : 0,
    input.marketingConsent === true ? input.consentSource ?? "booking" : null,
    input.marketingConsent === true ? now : null,
    now,
    now
  );
  return Number(res.lastInsertRowid);
}

export type PassEntitlementRow = {
  passId: number;
  label: string;
  creditsLeft: number;
  expiresAt: string;
};

export async function entitlementsForCustomer(customerId: number): Promise<{
  passes: PassEntitlementRow[];
  membership: {
    membershipId: number;
    label: string;
    classTypeIds: number[] | null;
    periodStart: string;
    periodEnd: string;
  } | null;
}> {
  const now = nowIso();
  const passes = all<{ id: number; credits_total: number; expires_at: string; product_name: string }>(
    `SELECT p.id, p.credits_total, p.expires_at, pr.name AS product_name
     FROM passes p JOIN products pr ON pr.id = p.product_id
     WHERE p.customer_id = ? AND p.status = 'active' AND p.expires_at > ?
     ORDER BY p.expires_at ASC`,
    customerId,
    now
  );
  const passRows: PassEntitlementRow[] = [];
  for (const p of passes) {
    // redeemed credits (delta < 0). 'purchase' rows are audit-only - the grant
    // lives in passes.credits_total, so they must not count as returns.
    const used = get<{ u: number }>(
      `SELECT COALESCE(SUM(-delta),0) AS u FROM pass_credit_ledger WHERE pass_id = ? AND delta < 0`,
      p.id
    )!;
    const returned = get<{ r: number }>(
      `SELECT COALESCE(SUM(delta),0) AS r FROM pass_credit_ledger WHERE pass_id = ? AND delta > 0 AND reason != 'purchase'`,
      p.id
    )!;
    const creditsLeft = Math.max(0, p.credits_total - used.u + returned.r);
    if (creditsLeft > 0) {
      passRows.push({ passId: p.id, label: p.product_name, creditsLeft, expiresAt: p.expires_at });
    }
  }

  const m = get<{ id: number; product_name: string; allowed_class_type_ids: string | null; current_period_start: string; current_period_end: string }>(
    `SELECT m.id, pr.name AS product_name, pr.allowed_class_type_ids, m.current_period_start, m.current_period_end
     FROM memberships m JOIN products pr ON pr.id = m.product_id
     WHERE m.customer_id = ? AND m.status = 'active'
       AND m.current_period_start <= ? AND m.current_period_end >= ?
     ORDER BY m.id DESC LIMIT 1`,
    customerId,
    now,
    now
  );
  const membership = m
    ? {
        membershipId: m.id,
        label: m.product_name,
        classTypeIds: m.allowed_class_type_ids ? (JSON.parse(m.allowed_class_type_ids) as number[]) : null,
        periodStart: m.current_period_start,
        periodEnd: m.current_period_end,
      }
    : null;
  return { passes: passRows, membership };
}

export function isNewCustomer(customerId: number): boolean {
  const paid = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM orders WHERE customer_id = ? AND status = 'paid'`,
    customerId
  )!;
  const existingPass = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM passes WHERE customer_id = ?`,
    customerId
  )!;
  return paid.c === 0 && existingPass.c === 0;
}

/** Membership period helper: a new monthly membership covers from payment until same day next month. */
export function membershipPeriod(recurrence: "monthly" | "annual", fromIso: string, tz: string): { start: string; end: string } {
  const d = new Date(fromIso);
  const end = new Date(d);
  if (recurrence === "monthly") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  // Memberships cover classes until the period end (local end-of-day is overkill; period end is exact instant)
  void tz;
  void zonedToUtc;
  return { start: d.toISOString(), end: end.toISOString() };
}
