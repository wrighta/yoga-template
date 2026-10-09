"use client";

import { useCallback, useEffect, useState, useActionState } from "react";
import Link from "next/link";
import { useCart } from "@/components/cart-provider";
import { Alert, btn, Card, Field } from "@/components/ui";
import { fmtEuro } from "@/lib/money";
import { startCheckoutAction, type CheckoutState } from "../actions";

type QuoteResponse = {
  holdMinutes?: number;
  blockMode?: {
    name: string;
    kind: string;
    description: string | null;
    venueName: string | null;
    classCount: number;
    dates: string;
    rangeLabel: string;
    remainingCapacity: number | null;
  };
  result?: {
    subtotalCents: number;
    discountCents: number;
    totalCents: number;
    chosen: { kind: string; label: string; explanation: string };
    lines: { kind: string; description: string; qty: number; unitCents: number; totalCents: number }[];
    alternatives: { kind: string; label: string; totalCents: number; savedCents: number }[];
    seats: { occurrenceId: number; source: string }[];
  };
  customerName?: string | null;
  classPassesEnabled?: boolean;
  signedIn?: boolean;
  hasPasses?: boolean;
  error?: string;
  empty?: boolean;
};

export function BookFlow({ signedIn, customerId, customerName, customerEmail, blockId, bundleId }: { signedIn: boolean; customerId: number | null; customerName: string | null; customerEmail: string | null; blockId?: number | null; bundleId?: number | null }) {
  const cart = useCart();
  const [name, setName] = useState(customerName ?? "");
  const [email, setEmail] = useState(customerEmail ?? "");
  const [attendeeNames, setAttendeeNames] = useState<string[]>([""]);
  const [phone, setPhone] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [state, action, pending] = useActionState<CheckoutState, FormData>(startCheckoutAction, null);

  const blockMode = !!(blockId || bundleId);

  const loadQuote = useCallback(
    async (ids: number[], c: string, attendeeCount: number) => {
      if (!blockMode && ids.length === 0) {
        setQuote(null);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            blockMode
              ? { blockId: blockId ?? undefined, bundleId: bundleId ?? undefined, attendeeCount, coupon: c || undefined }
              : { occurrenceIds: ids, coupon: c || undefined }
          ),
        });
        setQuote(await res.json());
      } catch {
        setQuote({ error: "Could not fetch prices - check your connection and try again." });
      } finally {
        setLoading(false);
      }
    },
    [blockMode, blockId, bundleId]
  );

  useEffect(() => {
    if (cart.ready) void loadQuote(cart.ids, appliedCoupon, attendeeNames.length);
  }, [cart.ready, cart.ids, appliedCoupon, attendeeNames.length, loadQuote]);

  if (!cart.ready) return null;

  if (!blockMode && cart.ids.length === 0) {
    return (
      <div className="space-y-6">
        <Alert>
          You haven&apos;t selected any classes yet. <Link href="/classes" className="font-semibold underline underline-offset-4">Browse the schedule</Link> and pick one or more dates.
        </Alert>
        <Link href="/classes" className={btn.primary}>View classes &amp; book</Link>
      </div>
    );
  }

  const r = quote?.result;
  const isGroupEvent = quote?.blockMode?.kind === "workshop" || quote?.blockMode?.kind === "retreat";
  const paidLines = r?.lines.filter((l) => l.kind === "class" || l.kind === "pass") ?? [];

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-6">
        {/* Selected classes */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">{quote?.blockMode ? quote.blockMode.name : "Your selected classes"}</h2>
          {quote?.blockMode ? (
            <div className="mt-3 text-sm text-bark-700">
              <p className="font-semibold text-forest-900">
                {isGroupEvent ? quote.blockMode.rangeLabel : `${quote.blockMode.rangeLabel} · ${quote.blockMode.classCount} classes`}
              </p>
              {quote.blockMode.dates ? <p className="mt-1 leading-relaxed text-bark-500">{quote.blockMode.dates}</p> : null}
              {isGroupEvent && quote.blockMode.description ? <p className="mt-2 leading-relaxed text-bark-700">{quote.blockMode.description}</p> : null}
              <p className="mt-2 rounded-xl bg-oat-100 px-3 py-2 text-xs text-bark-700">
                {isGroupEvent ? "One booking covers the whole event. Add each attendee below." : "One payment books you into every date. Block and bundle bookings are non-refundable."}
              </p>
            </div>
          ) : (
          <>
          <ul className="mt-4 divide-y divide-oat-100">
            {cart.ids.map((id) => {
              const line = r?.lines.find((l) => (l as { occurrenceId?: number }).occurrenceId === id && l.kind === "class");
              return (
                <li key={id} className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-bark-700">{line?.description ?? `Class #${id}`}</span>
                  <button
                    type="button"
                    onClick={() => cart.remove(id)}
                    className="text-sm font-semibold text-clay-700 underline underline-offset-4"
                    aria-label={`Remove ${line?.description ?? "class"}`}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <Link href="/classes" className="mt-2 inline-block text-sm font-semibold text-forest-800 underline underline-offset-4">
            + Add more dates
          </Link>
          </>
          )}
        </Card>

        {/* Details form */}
        <form action={action} id="booking-form">
          {blockMode ? (
            <>
              <input type="hidden" name="blockId" value={blockId ?? ""} />
              <input type="hidden" name="bundleId" value={bundleId ?? ""} />
              <input type="hidden" name="occurrenceIds" value="[]" />
            </>
          ) : (
            <input type="hidden" name="occurrenceIds" value={JSON.stringify(cart.ids)} />
          )}
          <input type="hidden" name="coupon" value={appliedCoupon} />
          <input type="hidden" name="customerId" value={customerId ?? ""} />
          {isGroupEvent ? <input type="hidden" name="attendeeNames" value={JSON.stringify(attendeeNames.map((attendee) => attendee.trim()).filter(Boolean))} /> : null}
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-forest-900">Your details</h2>
            <p className="mt-1 text-sm text-bark-500">
              {signedIn
                ? `Booking as ${customerEmail}${customerName ? ` (${customerName})` : ""}.`
                : "No account needed - we'll email your confirmation."}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Full name" name="name" required autoComplete="name" value={name} onChange={setName} />
              <Field label="Email" name="email" type="email" required autoComplete="email" value={email} onChange={setEmail} hint="Your confirmation and class reminders go here." />
              <Field label="Mobile number" name="phone" type="tel" required autoComplete="tel" value={phone} onChange={setPhone} hint="So we can reach you about last-minute class changes." />
            </div>

            {isGroupEvent ? (
              <fieldset className="mt-5 border-t border-oat-100 pt-5">
                <legend className="font-semibold text-forest-900">Attendees</legend>
                <p className="mt-1 text-sm text-bark-500">Enter the name of each person attending. The contact details above are for the payer.</p>
                <div className="mt-3 space-y-3">
                  {attendeeNames.map((attendee, index) => (
                    <div key={index} className="flex items-end gap-3">
                      <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-semibold text-forest-900">
                        Attendee {index + 1} name
                        <input required value={attendee} onChange={(event) => setAttendeeNames((current) => current.map((value, item) => item === index ? event.target.value : value))} className="rounded-xl border border-oat-300 px-4 py-3 text-base font-normal" />
                      </label>
                      {attendeeNames.length > 1 ? <button type="button" onClick={() => setAttendeeNames((current) => current.filter((_, item) => item !== index))} className="mb-1 min-h-[44px] px-2 text-sm font-semibold text-clay-700 underline underline-offset-4" aria-label={`Remove attendee ${index + 1}`}>Remove</button> : null}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={attendeeNames.length >= Math.min(20, quote?.blockMode?.remainingCapacity ?? 20)}
                  onClick={() => setAttendeeNames((current) => [...current, ""])}
                  className="mt-3 min-h-[44px] rounded-full border border-forest-800/30 px-4 py-2 text-sm font-semibold text-forest-800 disabled:opacity-50"
                >
                  + Add another attendee
                </button>
                {quote?.blockMode?.remainingCapacity != null ? <p className="mt-2 text-xs text-bark-500">{quote.blockMode.remainingCapacity} places currently available.</p> : null}
              </fieldset>
            ) : null}

            {r && r.seats.some((s) => s.source === "pass" || s.source === "membership") && (
              <Alert kind="info">
                Some of your seats are covered by your pass/membership - they&apos;re included in the total below.
              </Alert>
            )}
            {!signedIn && quote?.classPassesEnabled && quote.hasPasses === false && (
              <p className="mt-4 text-sm text-bark-500">
                Have a class pass?{" "}
                <Link href={`/account?next=${encodeURIComponent("/book")}`} className="font-semibold text-forest-800 underline underline-offset-4">
                  Sign in with your email
                </Link>{" "}
                to use your credits automatically.
              </p>
            )}

            <div className="mt-6 space-y-4 border-t border-oat-100 pt-6">
              <label className="flex items-start gap-3 text-sm text-bark-700">
                <input type="checkbox" name="terms" required checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="mt-1 h-5 w-5 rounded accent-forest-800" />
                <span>
                  I accept the{" "}
                  <Link href="/policies/booking-terms" className="font-semibold text-forest-800 underline underline-offset-4" target="_blank">
                    booking &amp; cancellation terms
                  </Link>{" "}
                  (cancel free up to 24 hours before a class).
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm text-bark-700">
                <input type="checkbox" name="marketing" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} className="mt-1 h-5 w-5 rounded accent-forest-800" />
                <span>Send me occasional news from Yoga with Anne (optional - not required to book).</span>
              </label>
            </div>

            {state?.error && (
              <div className="mt-6">
                <Alert kind="error">{state.error}</Alert>
              </div>
            )}

            <button
              type="submit"
              disabled={pending || loading || !r || r.totalCents === undefined}
              className={`${btn.primary} mt-6 w-full`}
            >
              {pending
                ? "Reserving your places…"
                : r && r.totalCents === 0
                  ? "Confirm booking - fully covered by your pass/membership"
                  : r
                    ? `Continue to payment - ${fmtEuro(r.totalCents)}`
                    : "Continue to payment"}
            </button>
            <p className="mt-3 text-center text-xs text-bark-500">
              Your places are held for {quote?.holdMinutes ?? 10} minutes once you continue. Nothing is charged until payment is confirmed.
            </p>
          </Card>
        </form>
      </div>

      {/* Quote summary */}
      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="p-6" aria-live="polite">
          <h2 className="text-lg font-semibold text-forest-900">Price summary</h2>
          {loading && !r ? (
            <p className="mt-4 text-sm text-bark-500">Calculating your best price…</p>
          ) : r ? (
            <>
              <ul className="mt-4 space-y-2 text-sm">
                {paidLines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-4">
                    <span className="text-bark-700">{l.description}</span>
                    <span className="font-semibold text-forest-900">{l.totalCents === 0 ? "-" : fmtEuro(l.totalCents)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 space-y-1.5 border-t border-oat-100 pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-bark-500">Subtotal</dt>
                  <dd>{fmtEuro(r.subtotalCents)}</dd>
                </div>
                {r.discountCents > 0 && (
                  <div className="flex justify-between font-semibold text-forest-700">
                    <dt>Applied: {r.chosen.label}</dt>
                    <dd>−{fmtEuro(r.discountCents)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-oat-100 pt-2 text-lg font-semibold text-forest-900">
                  <dt>Total</dt>
                  <dd>{fmtEuro(r.totalCents)}</dd>
                </div>
              </dl>
              <p className="mt-3 rounded-xl bg-sage-100 px-4 py-3 text-xs leading-relaxed text-forest-900">
                {r.chosen.explanation}
              </p>

              {r.alternatives.filter((a) => a.kind !== r.chosen.kind && a.savedCents > 0).length > 0 && (
                <div className="mt-4 border-t border-oat-100 pt-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-bark-500">Also available</p>
                  <ul className="mt-2 space-y-1 text-xs text-bark-700">
                    {r.alternatives
                      .filter((a) => a.kind !== r.chosen.kind && a.savedCents > 0)
                      .slice(0, 3)
                      .map((a) => (
                        <li key={a.kind}>
                          {a.label}: {fmtEuro(a.totalCents)} (save {fmtEuro(a.savedCents)})
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {/* Coupon - never applicable to blocks/bundles */}
              <div className={blockMode ? "hidden" : "mt-4 border-t border-oat-100 pt-4"}>
                <label htmlFor="coupon-try" className="text-xs font-bold uppercase tracking-wider text-bark-500">
                  Coupon code
                </label>
                  <div className="mt-2 flex gap-2">
                    <input
                      id="coupon-try"
                      value={coupon}
                      onChange={(e) => setCoupon(e.target.value)}
                      placeholder="e.g. SUMMER10"
                      className="min-w-0 flex-1 rounded-xl border border-oat-300 px-3 py-2 text-sm uppercase"
                    />
                    <button type="button" onClick={() => setAppliedCoupon(coupon.trim())} className="rounded-xl border-2 border-forest-800 px-4 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100">
                      Apply
                    </button>
                  </div>
                {appliedCoupon && (
                  <p className="mt-2 text-xs text-bark-500">
                    Applied “{appliedCoupon}”.{" "}
                    <button type="button" className="underline underline-offset-4" onClick={() => { setAppliedCoupon(""); setCoupon(""); }}>
                      Remove
                    </button>
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-bark-500">{quote?.error ?? "Add dates to see your price."}</p>
          )}
        </Card>
      </div>
      <noscript>
        <Alert kind="error">
          This booking page needs JavaScript. To book without it, please use the contact page and Anne will sort you out.
        </Alert>
      </noscript>
    </div>
  );
}
