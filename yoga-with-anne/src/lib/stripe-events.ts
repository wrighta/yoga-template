import { get, run, tx, nowIso } from "@/db";
import { membershipPeriod } from "./customers";
import { sendTemplate } from "./mail";
import { fmtDate } from "./tz";
import { getSettings } from "./settings";

/**
 * Stripe membership lifecycle handlers, separated from webhook transport so
 * integration tests can exercise them directly (signed-fixture semantics).
 * All lookups go through memberships.stripe_subscription_id, which is written
 * atomically with the membership at checkout completion (see markOrderPaid).
 */
export async function handleInvoicePaid(invoice: { subscription?: string }) {
  if (!invoice.subscription) return;
  const m = get<{ id: number; customer_id: number; product_id: number }>(
    `SELECT * FROM memberships WHERE stripe_subscription_id = ?`,
    invoice.subscription
  );
  if (!m) return; // unknown subscription - nothing to renew
  const product = get<{ recurrence: string | null; name: string }>(`SELECT * FROM products WHERE id = ?`, m.product_id)!;
  const settings = await getSettings();
  const period = membershipPeriod(product.recurrence === "annual" ? "annual" : "monthly", nowIso(), settings.timezone);
  tx(() => {
    run(
      `UPDATE memberships SET status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ? WHERE id = ?`,
      period.start, period.end, nowIso(), m.id
    );
  });
  const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, m.customer_id);
  if (customer) {
    await sendTemplate("membership_started", customer.email, {
      customer_name: customer.name ?? "there",
      membership_name: product.name,
      renewal_date: fmtDate(period.end, settings.timezone, true),
    });
  }
}

export async function handleInvoicePaymentFailed(invoice: { subscription?: string }) {
  if (!invoice.subscription) return;
  const m = get<{ id: number; customer_id: number }>(`SELECT * FROM memberships WHERE stripe_subscription_id = ?`, invoice.subscription);
  if (!m) return;
  run(`UPDATE memberships SET status = 'past_due', updated_at = ? WHERE id = ?`, nowIso(), m.id);
  const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, m.customer_id);
  const product = get<{ name: string }>(`SELECT name FROM products WHERE id = (SELECT product_id FROM memberships WHERE id = ?)`, m.id);
  if (customer) {
    await sendTemplate("membership_payment_failed", customer.email, {
      customer_name: customer.name ?? "there",
      membership_name: product?.name ?? "membership",
    });
  }
}

export async function handleSubscriptionDeleted(sub: { id?: string }) {
  if (!sub.id) return;
  run(`UPDATE memberships SET status = 'cancelled', updated_at = ? WHERE stripe_subscription_id = ?`, nowIso(), sub.id);
}
