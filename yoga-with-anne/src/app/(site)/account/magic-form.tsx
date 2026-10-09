"use client";

import { useActionState } from "react";
import { requestMagicLink } from "./actions";
import { Alert } from "@/components/ui";

export function MagicForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(requestMagicLink, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {state && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <label htmlFor="magic-email" className="text-sm font-semibold text-forest-900">Email address</label>
      <input
        id="magic-email"
        name="email"
        type="email"
        required
        autoComplete="email"
        className="rounded-xl border border-oat-300 bg-white px-4 py-3 text-base focus:border-forest-700"
      />
      <button type="submit" disabled={pending} className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900 disabled:opacity-50">
        {pending ? "Checking…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
