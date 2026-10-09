import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { get, all } from "@/db";
import { Card } from "@/components/ui";
import { fmtEuro } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { stripeEnabled } from "@/lib/stripe";
import { devPaymentsEnabled as runtimeDevPaymentsEnabled } from "@/lib/runtime";
import { TestPayButtons } from "./test-pay-buttons";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ failed?: string; error?: string }>;
}) {
  const { ref } = await params;
  const { failed, error } = await searchParams;
  const order = get<{ id: number; ref: string; status: string; total_cents: number; checkout_mode: string | null; stripe_session_id: string | null }>(
    `SELECT id, ref, status, total_cents, checkout_mode, stripe_session_id FROM orders WHERE ref = ?`,
    ref
  );
  if (!order) notFound();
  if (order.status === "paid") redirect(`/book/confirmed/${ref}`);

  // Real Stripe mode: bounce straight to the hosted session
  if (stripeEnabled() && order.checkout_mode === "stripe" && order.stripe_session_id) {
    const sessionUrl = await retrieveSessionUrl(order.stripe_session_id);
    if (sessionUrl) redirect(sessionUrl);
  }

  const settings = await getSettings();
  const devPaymentsEnabled = !stripeEnabled() && runtimeDevPaymentsEnabled();
  if (!devPaymentsEnabled) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-forest-900">Payment unavailable</h1>
        <p className="mt-3 text-bark-700">
          Online payment isn&apos;t configured right now, so this order can&apos;t be completed here. Your places
          haven&apos;t been charged. Please contact Anne on {settings.contact_phone_display} and she&apos;ll sort out your booking.
        </p>
      </div>
    );
  }

  const items = all<{ description: string; total_cents: number }>(
    `SELECT description, total_cents FROM order_items WHERE order_id = ?`,
    order.id
  );

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <div className="rounded-2xl border-2 border-dashed border-gold-600 bg-gold-200/40 px-5 py-4 text-center">
        <p className="text-sm font-bold uppercase tracking-wider text-gold-800">Test payment page</p>
        <p className="mt-1 text-sm text-bark-700">
          No Stripe key is configured, so this safe simulation completes your booking without moving money. In production
          this step is a secure Stripe Checkout page.
        </p>
      </div>

      <h1 className="mt-8 text-3xl font-semibold text-forest-900">Complete your booking</h1>
      <p className="mt-2 text-bark-700">Order {order.ref}</p>

      <Card className="mt-6 p-6">
        <ul className="space-y-2 text-sm">
          {items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-4">
              <span className="text-bark-700">{i.description}</span>
              <span className="font-semibold">{i.total_cents === 0 ? "-" : fmtEuro(i.total_cents)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex justify-between border-t border-oat-100 pt-4 text-lg font-semibold text-forest-900">
          <span>Total</span>
          <span>{fmtEuro(order.total_cents)}</span>
        </p>
        <p className="mt-1 text-xs text-bark-500">
          Prices in {settings.currency}. Cancel free up to {settings.cancellation_cutoff_hours} hours before each class.
        </p>
      </Card>

      {failed ? (
        <div className="mt-4 rounded-xl bg-clay-100 px-4 py-3 text-sm font-medium text-clay-700" role="alert">
          Payment marked as failed - this is what a customer sees when a card is declined. Try again below.
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-xl bg-clay-100 px-4 py-3 text-sm font-medium text-clay-700" role="alert">
          There was a problem with the payment provider. Please try again.
        </div>
      ) : null}

      <TestPayButtons ref_={order.ref} />
    </div>
  );
}

async function retrieveSessionUrl(sessionId: string): Promise<string | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = (await res.json()) as { url?: string };
    return json.url ?? null;
  } catch {
    return null;
  }
}
