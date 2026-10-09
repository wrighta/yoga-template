import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false } };

export default async function AdminLoginPage() {
  const admin = await requireAdmin();
  if (admin) redirect("/admin");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-oat-100 px-4">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-oat-200 bg-white p-8">
        <h1 className="font-display text-2xl font-semibold text-forest-900">Yoga with Anne</h1>
        <p className="mt-1 text-sm text-bark-500">Staff sign-in</p>
        <div className="mt-6">
          <AdminLoginForm />
        </div>
      </div>
    </div>
  );
}
