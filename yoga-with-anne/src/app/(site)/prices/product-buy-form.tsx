"use client";

import { useActionState, useState } from "react";
import { productCheckoutAction, type CheckoutState } from "@/app/(site)/actions";
import { Alert } from "@/components/ui";

export function ProductBuyForm({
  productId,
  name,
  isMembership,
  cta,
}: {
  productId: number;
  name: string;
  isMembership: boolean;
  cta: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CheckoutState, FormData>(productCheckoutAction, null);
  const [buyerName, setBuyerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900"
        >
          {cta}
        </button>
      ) : (
        <form action={action} className="mt-2 flex flex-col gap-3 rounded-xl bg-oat-50 p-4">
          <p className="text-sm font-semibold text-forest-900">Buying: {name}</p>
          <label className="sr-only" htmlFor={`n-${productId}`}>Full name</label>
          <input id={`n-${productId}`} name="name" required autoComplete="name" placeholder="Your full name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className="rounded-xl border border-oat-300 bg-white px-4 py-3" />
          <label className="sr-only" htmlFor={`e-${productId}`}>Email</label>
          <input id={`e-${productId}`} name="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-xl border border-oat-300 bg-white px-4 py-3" />
          <label className="sr-only" htmlFor={`p-${productId}`}>Mobile</label>
          <input id={`p-${productId}`} name="phone" type="tel" required autoComplete="tel" placeholder="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-xl border border-oat-300 bg-white px-4 py-3" />
          <input type="hidden" name="productId" value={productId} />
          <label className="flex items-start gap-3 text-sm text-bark-700">
            <input type="checkbox" name="terms" required className="mt-1 h-5 w-5 rounded accent-forest-800" />
            <span>I accept the booking terms (opens the cancellation policy in checkout).</span>
          </label>
          {isMembership && (
            <label className="flex items-start gap-3 text-sm text-bark-700">
              <input type="checkbox" name="recurring" required className="mt-1 h-5 w-5 rounded accent-forest-800" />
              <span>
                <strong>Renewal consent:</strong> I understand this membership renews automatically each month/year until I
                cancel, and I can cancel any time before renewal.
              </span>
            </label>
          )}
          {state?.error && <Alert kind="error">{state.error}</Alert>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="min-h-[48px] flex-1 rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900 disabled:opacity-50">
              {pending ? "Preparing payment…" : "Continue to payment"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-[48px] rounded-full border-2 border-forest-800 px-4 py-3 font-semibold text-forest-800">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
