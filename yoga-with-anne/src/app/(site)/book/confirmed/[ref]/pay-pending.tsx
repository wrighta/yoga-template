"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";

export function PayPending({ ref_, useStripe, message }: { ref_: string; useStripe: boolean; message: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(async () => {
      setSeconds((s) => s + 1);
      try {
        const res = await fetch(`/api/order-status/${ref_}`, { cache: "no-store" });
        const json = (await res.json()) as { status?: string };
        if (json.status === "paid") window.location.reload();
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [ref_]);

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
      <Card className="p-10">
        <span aria-hidden="true" className="mx-auto mb-6 block h-10 w-10 animate-spin rounded-full border-4 border-sage-200 border-t-forest-800" />
        <h1 className="text-2xl font-semibold text-forest-900">Finalising your booking…</h1>
        <p className="mt-3 text-bark-700">{message}</p>
        <p className="mt-1 text-sm text-bark-500">Order {ref_}{useStripe ? " · Stripe" : ""}</p>
        <p className="mt-6 text-xs text-bark-500">
          {seconds > 20
            ? "Still waiting - if you completed the payment, this page will update automatically. You can also check your email."
            : "This page updates automatically. Don't worry about closing it."}
        </p>
      </Card>
    </div>
  );
}
