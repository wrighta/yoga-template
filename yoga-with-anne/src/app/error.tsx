"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log a short, non-sensitive marker for server-side diagnosis
    console.error("[app] handled error", error.digest ?? "(no digest)");
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="font-display text-3xl font-semibold text-forest-900">Something went wrong</h1>
      <p className="max-w-md text-bark-700">
        Sorry - an unexpected error occurred. Please try again in a moment.
      </p>
      <p className="max-w-md text-sm text-bark-500">
        If you were in the middle of paying, please don&apos;t retry the payment yet - check{" "}
        <Link href="/account" className="font-semibold text-forest-800 underline underline-offset-4">My bookings</Link>{" "}
        or your email first to see whether your booking already went through. If you&apos;re unsure, message Anne and
        she&apos;ll check for you.
      </p>
      {error.digest ? <p className="text-xs text-bark-500">Reference: {error.digest}</p> : null}
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="inline-flex min-h-[48px] items-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900">
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-[48px] items-center rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800 hover:bg-sage-100">
          Back to homepage
        </Link>
      </div>
      <p className="text-sm text-bark-500">
        Need help? Head to the{" "}
        <Link href="/contact" className="font-semibold text-forest-800 underline underline-offset-4">
          contact page
        </Link>{" "}
        to reach Anne.
      </p>
    </div>
  );
}
