import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCustomer } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/runtime";
import { MagicForm } from "./magic-form";

export const metadata: Metadata = { title: "My bookings", robots: { index: false } };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const customer = await requireCustomer();
  if (customer) redirect("/account/home");
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold text-forest-900">My bookings</h1>
      <p className="mt-3 text-bark-700">
        Sign in with the email you booked with to see your classes, passes and membership. No password needed - we&apos;ll
        email you a one-tap link.
      </p>
      <div className="mt-8">
        <MagicForm next={safeRedirectPath(next, "/account/home")} />
      </div>
    </div>
  );
}
