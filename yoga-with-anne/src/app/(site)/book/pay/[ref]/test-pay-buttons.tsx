"use client";

import { testPayAction } from "@/app/(site)/actions";
import { useFormStatus } from "react-dom";

function Submit({ children, tone }: { children: React.ReactNode; tone: "pay" | "fail" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="outcome"
      value={tone === "pay" ? "success" : "fail"}
      disabled={pending}
      className={
        tone === "pay"
          ? "inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900 disabled:opacity-50"
          : "inline-flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-clay-600 px-6 py-3 font-semibold text-clay-700 hover:bg-clay-100 disabled:opacity-50"
      }
    >
      {pending ? "Processing…" : children}
    </button>
  );
}

export function TestPayButtons({ ref_ }: { ref_: string }) {
  return (
    <form action={testPayAction} className="mt-6 space-y-3">
      <input type="hidden" name="ref" value={ref_} />
      <Submit tone="pay">Pay now (test) → confirms my booking</Submit>
      <Submit tone="fail">Simulate a failed payment</Submit>
    </form>
  );
}
