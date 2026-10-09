import { get, run, nowIso } from "@/db";

/**
 * Create a Stripe Billing Portal session for a customer so they can manage
 * payment methods and membership cancellation. Returns a friendly error when
 * Stripe isn't configured (the UI hides the entry point in that case).
 */
export async function createBillingPortalUrl(customerId: number, origin: string): Promise<{ url: string } | { error: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { error: "Online account management isn't available yet. To change your membership, just message Anne." };
  }
  const customer = get<{ email: string; name: string | null; stripe_customer_id: string | null }>(
    `SELECT email, name, stripe_customer_id FROM customers WHERE id = ?`,
    customerId
  );
  if (!customer) return { error: "Please sign in first." };
  try {
    let stripeCustomerId = customer.stripe_customer_id;
    if (!stripeCustomerId) {
      const body = new URLSearchParams({ email: customer.email, name: customer.name ?? "" });
      const res = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const json = (await res.json()) as { id?: string };
      if (!res.ok || !json.id) return { error: "Could not reach Stripe - please try again later." };
      stripeCustomerId = json.id;
      run(`UPDATE customers SET stripe_customer_id = ?, updated_at = ? WHERE id = ?`, stripeCustomerId, nowIso(), customerId);
    }
    const body = new URLSearchParams({
      customer: stripeCustomerId,
      return_url: `${origin}/account/home`,
    });
    const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json()) as { url?: string };
    if (!res.ok || !json.url) return { error: "Could not open the billing portal - please try again later." };
    return { url: json.url };
  } catch {
    return { error: "Could not reach Stripe - please try again later." };
  }
}
