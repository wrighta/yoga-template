"use server";

import { redirect } from "next/navigation";
import { upsertCustomer, normalizeEmail } from "@/lib/customers";
import { joinWaitlist, startCheckout, markOrderPaid } from "@/lib/booking";
import { run, get } from "@/db";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { sendTemplate } from "@/lib/mail";
import { revalidatePath } from "next/cache";
import { createStripeCheckout, stripeEnabled } from "@/lib/stripe";
import { fmtEuro } from "@/lib/money";
import { devPaymentsEnabled, safeRedirectPath } from "@/lib/runtime";

export async function newsletterSignup(_prev: { ok: boolean; message: string } | null, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const consent = formData.get("consent") === "on";
  if (!email.includes("@")) return { ok: false, message: "Please enter a valid email address." };
  if (!consent) return { ok: false, message: "Please tick the consent box so we're allowed to email you." };
  upsertCustomer({ email, marketingConsent: true, consentSource: "newsletter" });
  return { ok: true, message: "You're on the list - thank you! One or two emails a month, and you can unsubscribe any time." };
}

export async function contactSubmit(_prev: { ok: boolean; message: string } | null, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const website = String(formData.get("website") ?? ""); // honeypot
  if (website) return { ok: true, message: "Thanks - your message has been received." };
  if (!name || !email.includes("@") || message.length < 5) {
    return { ok: false, message: "Please fill in your name, a valid email and a short message." };
  }
  const ip = await getIp();
  const rl = rateLimit(`contact:${ip}`, 5, 10 * 60_000);
  if (!rl.ok) return { ok: false, message: `Too many messages just now - please try again in ${rl.retryAfterSec} seconds or WhatsApp Anne.` };
  run(`INSERT INTO contact_messages (name, email, phone, message, ip) VALUES (?,?,?,?,?)`, name, email, phone, message, ip);
  const ack = get<{ v: string }>(`SELECT value FROM settings WHERE key = 'contact_ack_enabled'`);
  if (!ack || ack.v === '"true"') {
    await sendTemplate("contact_ack", email, { customer_name: name });
  }
  return { ok: true, message: "Thanks - your message is with Anne. She'll reply as soon as she can, usually within a day." };
}

async function getIp(): Promise<string> {
  const { headers } = await import("next/headers");
  return clientIp(await headers());
}

export async function waitlistJoin(formData: FormData) {
  const occurrenceId = Number(formData.get("occurrenceId"));
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  if (!occurrenceId || !email.includes("@") || !name || !phone || phone.replace(/[^0-9]/g, "").length < 7) {
    redirect(`/classes?waitlist_error=${encodeURIComponent("Please provide your name, email and mobile number.")}`);
  }
  const ip = await getIp();
  const rl = rateLimit(`waitlist:${ip}`, 10, 10 * 60_000);
  if (!rl.ok) redirect(`/classes?waitlist_error=${encodeURIComponent("Too many requests - try again shortly.")}`);
  const customerId = upsertCustomer({ email, name, phone, consentSource: "waitlist" });
  const res = await joinWaitlist(occurrenceId, customerId);
  revalidatePath(`/classes/${occurrenceId}`);
  if (!res.ok) {
    redirect(`/classes/${occurrenceId}?waitlist_error=${encodeURIComponent(res.error ?? "Could not join waitlist")}`);
  }
  redirect(`/classes/${occurrenceId}?joined=1`);
}

export type CheckoutState = { error: string } | null;

/** Main booking checkout: creates holds + order, redirects to payment. */
export async function startCheckoutAction(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const ip = await getIp();
  const rl = rateLimit(`checkout:${ip}`, 20, 10 * 60_000);
  if (!rl.ok) return { error: "Too many attempts - please wait a moment and try again." };

  let ids: number[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("occurrenceIds") ?? "[]"));
    ids = Array.isArray(parsed) ? parsed.map(Number).filter(Number.isInteger) : [];
  } catch {
    return { error: "Something went wrong with your selection - please go back and choose your classes again." };
  }
  const coupon = String(formData.get("coupon") ?? "").trim() || null;
  const customerId = Number(formData.get("customerId")) || null;
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const blockId = Number(formData.get("blockId")) || null;
  const bundleId = Number(formData.get("bundleId")) || null;
  let attendeeNames: string[] | undefined;
  try {
    const parsedAttendees = JSON.parse(String(formData.get("attendeeNames") ?? "[]"));
    if (Array.isArray(parsedAttendees)) attendeeNames = parsedAttendees.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean);
  } catch {
    return { error: "Please check the attendee names and try again." };
  }

  const outcome = await startCheckout({
    email,
    name,
    phone: String(formData.get("phone") ?? "").trim() || null,
    occurrenceIds: blockId || bundleId ? [] : ids,
    marketingConsent: formData.get("marketing") === "on",
    acceptTerms: formData.get("terms") === "on",
    couponCode: coupon,
    customerId,
    blockId,
    bundleId,
    attendeeNames,
  });
  if (!outcome.ok) return { error: outcome.error };

  const { headers } = await import("next/headers");
  const origin = (await headers()).get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  if (outcome.mode === "stripe") {
    const order = get<{ id: number; total_cents: number }>(`SELECT id, total_cents FROM orders WHERE ref = ?`, outcome.orderRef)!;
    const items = (await import("@/db")).all<{ description: string; unit_cents: number; qty: number }>(
      `SELECT description, unit_cents, qty FROM order_items WHERE order_id = ? AND kind IN ('class','pass','block','bundle') AND total_cents > 0`,
      order.id
    );
    const holdSettings = await (async () => (await import("@/lib/settings")).getSettings())();
    const session = await createStripeCheckout({
      orderRef: outcome.orderRef,
      lines: items.map((i) => ({ description: i.description, unitCents: i.unit_cents, qty: i.qty })),
      customerEmail: normalizeEmail(email),
      successUrl: `${origin}/book/confirmed/${outcome.orderRef}?session=1`,
      cancelUrl: `${origin}/book?cancelled=1`,
      expiresAtSeconds: Math.floor(Date.now() / 1000) + Math.max(30, holdSettings.hold_minutes + 1) * 60,
    });
    if ("url" in session) {
      run(`UPDATE orders SET stripe_session_id = ?, checkout_mode = 'stripe' WHERE ref = ?`, session.sessionId, outcome.orderRef);
      redirect(session.url);
    }
    // fall through to test page if Stripe failed (visible error on test page)
    return { error: `Payment provider error: ${session.error}. Your order is saved - try again or contact Anne.` };
  }
  redirect(`/book/pay/${outcome.orderRef}`);
}

/** Buy a pass or membership directly (no class seats). */
export async function productCheckoutAction(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const ip = await getIp();
  const rl = rateLimit(`product:${ip}`, 20, 10 * 60_000);
  if (!rl.ok) return { error: "Too many attempts - please wait a moment and try again." };

  const productId = Number(formData.get("productId"));
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const terms = formData.get("terms") === "on";
  const recurring = formData.get("recurring") === "on";

  const product = get<{ id: number; kind: string; name: string; price_cents: number; recurrence: string | null }>(
    `SELECT * FROM products WHERE id = ? AND active = 1`,
    productId
  );
  if (!product) return { error: "This option is no longer available." };
  if (!name || !email.includes("@")) return { error: "Please provide your name and a valid email address." };
  if (phone.replace(/[^0-9]/g, "").length < 7) {
    return { error: "Please add your mobile number - it's how we reach you about last-minute class changes." };
  }
  if (!terms) return { error: "Please accept the booking terms to continue." };
  if (product.kind === "membership" && !recurring) {
    return { error: "Please confirm you understand this membership renews automatically." };
  }
  const { getSettings } = await import("@/lib/settings");
  const settings = await getSettings();
  if (!settings.checkout_enabled) {
    return { error: "Online booking is temporarily paused. Please contact Anne to buy a pass or membership." };
  }
  if (product.kind === "membership" && !settings.memberships_enabled) {
    return { error: "Memberships aren't available right now." };
  }
  if (product.kind === "pass" && !settings.class_passes_enabled) {
    return { error: "Class passes aren't available right now." };
  }
  if (product.kind === "pass" && !settings.class_passes_enabled) {
    return { error: "Class passes aren't available right now." };
  }
  // FAIL CLOSED: required booking policies must be published for any real checkout.
  const missingPolicies = (await import("@/db")).all<{ title: string }>(
    `SELECT title FROM policies WHERE requires_acceptance = 1 AND status != 'published'`
  );
  if (missingPolicies.length > 0) {
    return { error: "Online purchases are temporarily unavailable while our booking terms are being updated. Please check back shortly, or message Anne on " + settings.contact_phone_display + "." };
  }

  const customerId = upsertCustomer({ email, name, phone: phone || null, consentSource: "purchase" });
  const ref = `YA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const { run: dbRun, nowIso } = await import("@/db");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + settings.hold_minutes * 60000).toISOString();
  const oRes = dbRun(
    `INSERT INTO orders (ref, customer_id, status, subtotal_cents, discount_cents, total_cents, recurring_consent, checkout_mode, expires_at, policy_versions, created_at, updated_at)
     VALUES (?,?, 'awaiting_payment', ?, 0, ?, ?, NULL, ?, ?, ?, ?)`,
    ref, customerId, product.price_cents, product.price_cents, product.kind === "membership" ? 1 : 0, expiresAt,
    JSON.stringify(awaitAcceptPolicies()), now, now
  );
  const orderId = Number(oRes.lastInsertRowid);
  dbRun(`INSERT INTO order_items (order_id, kind, product_id, description, qty, unit_cents, total_cents) VALUES (?,?,?,?,?,?,?)`,
    orderId, product.kind === "membership" ? "membership" : "pass", product.id, product.name, 1, product.price_cents, product.price_cents);

  if (stripeEnabled()) {
    const origin = (await (await import("next/headers")).headers()).get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const session = await createStripeCheckout({
      orderRef: ref,
      lines: [],
      customerEmail: normalizeEmail(email),
      successUrl: `${origin}/book/confirmed/${ref}?session=1`,
      cancelUrl: `${origin}/prices?cancelled=1`,
      membership: product.kind === "membership"
        ? { name: product.name, unitCents: product.price_cents, recurrence: product.recurrence === "annual" ? "annual" : "monthly" }
        : null,
      expiresAtSeconds: Math.floor(Date.now() / 1000) + Math.max(30, settings.hold_minutes + 1) * 60,
    });
    if ("url" in session) {
      dbRun(`UPDATE orders SET stripe_session_id = ?, checkout_mode = 'stripe' WHERE id = ?`, session.sessionId, orderId);
      redirect(session.url);
    }
    return { error: `Payment provider error: ${(session as { error: string }).error}. Please try again.` };
  }
  redirect(`/book/pay/${ref}`);
}

async function awaitAcceptPolicies(): Promise<{ slug: string; version: number }[]> {
  const rows = (await import("@/db")).all<{ slug: string; version: number }>(
    `SELECT slug, version FROM policies WHERE requires_acceptance = 1 AND status = 'published'`
  );
  return rows.map((r) => ({ slug: r.slug, version: r.version }));
}

/** Test-payment simulator - development only, fails closed in production. */
export async function testPayAction(formData: FormData) {
  const ref = String(formData.get("ref") ?? "");
  const outcome = String(formData.get("outcome") ?? "success");
  if (!devPaymentsEnabled()) redirect(`/book/pay/${ref}?error=1`);
  if (outcome === "fail") {
    run(`UPDATE payments SET status = 'failed' WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, ref);
    redirect(`/book/pay/${ref}?failed=1`);
  }
  await markOrderPaid(ref, { provider: "test", providerRef: `test-${ref}` });
  revalidatePath(`/book/confirmed/${ref}`);
  redirect(`/book/confirmed/${ref}`);
}

export async function submitEnquiry(_prev: { ok: boolean; message: string } | null, formData: FormData) {
  const topic = String(formData.get("topic") ?? "Private lesson").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const groupSize = String(formData.get("groupSize") ?? "").trim();
  const preferredDates = String(formData.get("preferredDates") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const website = String(formData.get("website") ?? ""); // honeypot
  if (website) return { ok: true, message: "Thanks - your enquiry has been received." };
  if (!name || !email.includes("@") || phone.replace(/[^0-9]/g, "").length < 7 || message.length < 5) {
    return { ok: false, message: "Please fill in your name, a valid email, your mobile number and a short note." };
  }
  const ip = await getIp();
  const rl = rateLimit(`enquiry:${ip}`, 5, 10 * 60_000);
  if (!rl.ok) return { ok: false, message: `Too many enquiries just now - please try again shortly or WhatsApp Anne.` };

  const composed = [
    `Interested in: ${topic}`,
    groupSize ? `Group size: ${groupSize}` : null,
    preferredDates ? `Preferred dates: ${preferredDates}` : null,
    "",
    message,
  ]
    .filter(Boolean)
    .join("\n");

  run(`INSERT INTO contact_messages (kind, name, email, phone, message, ip) VALUES ('enquiry',?,?,?,?,?)`, name, email, phone, composed, ip);
  await sendTemplate("contact_ack", email, { customer_name: name });
  revalidatePath("/admin/messages");
  return { ok: true, message: "Thanks - your enquiry is with Anne. She'll reply personally, usually within a day." };
}
