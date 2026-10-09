"use client";

import { useActionState } from "react";
import { adminLoginAction } from "@/app/admin/actions";
import { Alert } from "@/components/ui";

export function AdminLoginForm() {
  const [state, action, pending] = useActionState(adminLoginAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="admin-email" className="text-sm font-semibold text-forest-900">Email</label>
        <input id="admin-email" name="email" type="email" required autoComplete="email" className="rounded-xl border border-oat-300 px-4 py-3" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="admin-password" className="text-sm font-semibold text-forest-900">Password</label>
        <input id="admin-password" name="password" type="password" required autoComplete="current-password" className="rounded-xl border border-oat-300 px-4 py-3" />
      </div>
      <button type="submit" disabled={pending} className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900 disabled:opacity-50">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
