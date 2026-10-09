import { createHmac, timingSafeEqual } from "node:crypto";

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

type Line = { description: string; unitCents: number; qty: number };

/**
 * Create a Stripe Checkout Session via the REST API (no SDK dependency).
 * mode = payment for one-off orders, subscription for memberships.
 */
export async function createStripeCheckout(opts: {
  orderRef: string;
  lines: Line[];
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  membership?: { name: string; unitCents: number; recurrence: "monthly" | "annual" } | null;
  /** Align the Stripe session lifetime with the business hold (min 30 min per Stripe). */
  expiresAtSeconds?: number;
}): Promise<{ url: string; sessionId: string } | { error: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { error: "Stripe not configured" };
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const body = new URLSearchParams();
  body.set("mode", opts.membership ? "subscription" : "payment");
  body.set("client_reference_id", opts.orderRef);
  body.set("customer_email", opts.customerEmail);
  body.set("success_url", opts.successUrl);
  body.set("cancel_url", opts.cancelUrl);
  body.set("metadata[order_ref]", opts.orderRef);
  body.set("locale", "en-IE");
  if (opts.expiresAtSeconds && opts.expiresAtSeconds > Math.floor(Date.now() / 1000) + 1800) {
    body.set("expires_at", String(opts.expiresAtSeconds));
  }

  if (opts.membership) {
    body.set("line_items[0][quantity]", "1");
    body.set("line_items[0][price_data][currency]", "eur");
    body.set("line_items[0][price_data][unit_amount]", String(opts.membership.unitCents));
    body.set("line_items[0][price_data][recurring][interval]", opts.membership.recurrence === "monthly" ? "month" : "year");
    body.set("line_items[0][price_data][product_data][name]", opts.membership.name);
    body.set("subscription_data[metadata][order_ref]", opts.orderRef);
  } else {
    opts.lines.forEach((l, i) => {
      body.set(`line_items[${i}][quantity]`, String(l.qty));
      body.set(`line_items[${i}][price_data][currency]`, "eur");
      body.set(`line_items[${i}][price_data][unit_amount]`, String(l.unitCents));
      body.set(`line_items[${i}][price_data][product_data][name]`, l.description.slice(0, 120));
    });
  }

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Idempotency so a double-submit cannot create two sessions for one order
        "Idempotency-Key": `checkout-${opts.orderRef}`,
      },
      body,
    });
    const json = (await res.json()) as { url?: string; id?: string; error?: { message: string } };
    if (!res.ok || !json.url || !json.id) {
      return { error: json.error?.message ?? `Stripe error (${res.status})` };
    }
    return { url: json.url, sessionId: json.id };
  } catch (e) {
    return { error: String(e) };
  }
}

export async function createStripeRefund(paymentIntentId: string, amountCents: number, reason: string): Promise<{ ok: boolean; error?: string; refundId?: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "Stripe not configured" };
  const body = new URLSearchParams();
  body.set("payment_intent", paymentIntentId);
  body.set("amount", String(amountCents));
  try {
    const res = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json()) as { id?: string; error?: { message: string } };
    if (res.ok && json.id) return { ok: true, refundId: json.id };
    return { ok: false, error: json.error?.message ?? `Stripe refund failed (${res.status})` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Verify a Stripe webhook signature header (Stripe-Sig: t=...,v1=...). */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const t = parts.find((p) => p[0] === "t")?.[1];
  const sigs = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!t || sigs.length === 0) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return sigs.some((s) => {
    try {
      return timingSafeEqual(Buffer.from(s, "hex"), Buffer.from(expected, "hex"));
    } catch {
      return false;
    }
  });
}
