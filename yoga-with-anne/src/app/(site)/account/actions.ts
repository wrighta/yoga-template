"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createMagicToken, consumeMagicToken, customerLogout, requireCustomer } from "@/lib/auth";
import { sendTemplate } from "@/lib/mail";
import { cancelBooking } from "@/lib/booking";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { run } from "@/db";
import { nowIso } from "@/db";
import { safeRedirectPath } from "@/lib/runtime";
import { createBillingPortalUrl } from "@/lib/portal";

export async function openBillingPortal(formData: FormData) {
  const customer = await requireCustomer();
  if (!customer) redirect("/account");
  const headers = await (await import("next/headers")).headers();
  const origin = headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const result = await createBillingPortalUrl(customer.id, origin);
  if ("url" in result) redirect(result.url);
  redirect("/account/home?portal=unavailable");
}

export async function requestMagicLink(_prev: { ok: boolean; message: string } | null, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = safeRedirectPath(String(formData.get("next") ?? ""), "/account/home");
  if (!email.includes("@")) return { ok: false, message: "Please enter the email address you booked with." };
  const headers = await (await import("next/headers")).headers();
  const rl = rateLimit(`magic:${clientIp(headers)}`, 5, 15 * 60_000);
  if (!rl.ok) return { ok: false, message: "Too many sign-in attempts - please try again in a few minutes." };

  const result = await createMagicToken(email);
  if (result) {
    const origin = headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const loginUrl = `${origin}/account/verify?token=${encodeURIComponent(result.token)}&next=${encodeURIComponent(next)}`;
    await sendTemplate("magic_login", result.email, { login_url: loginUrl });
  }
  // identical response either way - no account enumeration
  return {
    ok: true,
    message: "If that email has bookings with us, a sign-in link is on its way. It expires in 15 minutes.",
  };
}

export async function verifyToken(token: string, next: string): Promise<{ ok: boolean; error?: string }> {
  const customerId = await consumeMagicToken(token);
  if (!customerId) return { ok: false, error: "This sign-in link has expired or was already used. Please request a new one." };
  void next;
  return { ok: true };
}

export async function accountLogout() {
  await customerLogout();
  redirect("/");
}

export async function customerCancelBooking(formData: FormData) {
  const customer = await requireCustomer();
  if (!customer) redirect("/account");
  const bookingId = Number(formData.get("bookingId"));
  const booking = (await import("@/db")).get<{ customer_id: number }>(`SELECT customer_id FROM bookings WHERE id = ?`, bookingId);
  if (!booking || booking.customer_id !== customer.id) redirect("/account/home?error=notfound");
  await cancelBooking(bookingId, customer.email, "customer");
  revalidatePath("/account/home");
  redirect("/account/home?cancelled=1");
}

export async function updateConsent(formData: FormData) {
  const customer = await requireCustomer();
  if (!customer) redirect("/account");
  const consent = formData.get("marketing") === "on";
  run(
    `UPDATE customers SET marketing_consent = ?, consent_source = CASE WHEN ? THEN 'account' ELSE consent_source END, consent_at = CASE WHEN ? THEN ? ELSE consent_at END, updated_at = ? WHERE id = ?`,
    consent ? 1 : 0,
    consent,
    consent,
    nowIso(),
    nowIso(),
    customer.id
  );
  revalidatePath("/account/home");
}
