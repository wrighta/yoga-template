"use client";

import { useActionState } from "react";
import { newsletterSignup } from "./actions";
import { Alert } from "@/components/ui";

export function NewsletterForm() {
  const [state, action, pending] = useActionState(newsletterSignup, null);
  return (
    <form action={action} className="mx-auto mt-6 flex max-w-md flex-col gap-4">
      {state && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <label htmlFor="newsletter-email" className="sr-only">Email address</label>
      <input
        id="newsletter-email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="rounded-full border border-oat-300 bg-white px-5 py-3 text-base focus:border-forest-700"
      />
      <label className="flex items-start gap-3 text-left text-sm text-bark-700">
        <input type="checkbox" name="consent" className="mt-1 h-5 w-5 rounded accent-forest-800" />
        <span>
          Yes, I&apos;d like occasional email updates from Yoga with Anne. I can unsubscribe at any time.{" "}
          <span className="text-bark-500">(Required to subscribe)</span>
        </span>
      </label>
      <button type="submit" disabled={pending} className="rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900 disabled:opacity-50 min-h-[48px]">
        {pending ? "Signing up…" : "Keep me posted"}
      </button>
    </form>
  );
}
