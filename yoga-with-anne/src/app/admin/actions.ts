"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { all, get, run, tx, nowIso, audit } from "@/db";
import { adminLogin, adminLogout, requireAdmin, canWrite, canAdminister, hashPassword, type AdminUser } from "@/lib/auth";
import { adminCreateBooking, adminCreateBlockBooking, cancelBooking, cancelOccurrence, transferEventBooking, markOrderPaid, offerNextWaitlistSeat, releaseExpiredHolds, expireWaitlistOffers, recordRefund, remainingRefundable } from "@/lib/booking";
import { setSetting, getSettings } from "@/lib/settings";
import { setContent } from "@/lib/content";
import { generateOccurrences, fmtDateTime } from "@/lib/tz";
import { fmtEuro, parseEuroInputToCents } from "@/lib/money";
import { createStripeRefund, stripeEnabled } from "@/lib/stripe";
import { sendTemplate } from "@/lib/mail";
import { rateLimit, resetRateLimit, clientIp } from "@/lib/ratelimit";

async function guard(): Promise<AdminUser> {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}
async function guardWrite() {
  const admin = await guard();
  if (!canWrite(admin.role)) throw new Error("Your role has read-only access.");
  return admin;
}
async function guardSuper() {
  const admin = await guard();
  if (!canAdminister(admin.role)) throw new Error("Only a Super Admin can manage website settings and content.");
  return admin;
}

// ---------- Auth ----------

export async function adminLoginAction(_prev: { error: string } | null, formData: FormData) {
  const headers = await (await import("next/headers")).headers();
  const rateLimitKey = `adminlogin:${clientIp(headers)}`;
  const rl = rateLimit(rateLimitKey, 8, 10 * 60_000);
  if (!rl.ok) return { error: "Too many attempts - try again in a few minutes." };
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const admin = await adminLogin(email, password);
  if (!admin) return { error: "Email or password is incorrect." };
  resetRateLimit(rateLimitKey);
  audit("admin.login", { actorType: "admin", actor: admin.email });
  redirect("/admin");
}
export async function adminLogoutAction() {
  await adminLogout();
  redirect("/admin/login");
}

// ---------- Schedule ----------

export async function createSeriesAction(formData: FormData) {
  const admin = await guardWrite();
  const title = String(formData.get("title") ?? "").trim() || "Weekly class";
  const weekdays = formData.getAll("weekdays").map(Number).filter((n) => n >= 1 && n <= 7);
  const startTime = String(formData.get("startTime") ?? "19:30");
  const endTime = String(formData.get("endTime") ?? "20:30");
  const capacity = Math.max(1, Number(formData.get("capacity") ?? 12));
  const fromDate = String(formData.get("fromDate") ?? "");
  const toDate = String(formData.get("toDate") ?? "");
  const priceOverride = parseEuroInputToCents(String(formData.get("priceOverride") ?? ""));
  const skipDates = String(formData.get("skipDates") ?? "")
    .split(/[\s,]+/)
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const publicationStatus = formData.get("publicationStatus") === "published" ? "published" : "draft";
  if (weekdays.length === 0 || !fromDate || !toDate || toDate < fromDate) {
    redirect("/admin/classes?error=Please+choose+at+least+one+day+and+a+valid+date+range");
  }
  const settings = await getSettings();
  // combo field: numeric = existing id, otherwise a free-typed name to create
  const classTypeField = String(formData.get("classTypeId") ?? "").trim();
  let classTypeId = /^\d+$/.test(classTypeField) ? Number(classTypeField) : null;
  if (!classTypeId && classTypeField) {
    const existing = get<{ id: number }>(`SELECT id FROM class_types WHERE name = ? COLLATE NOCASE`, classTypeField);
    if (existing) {
      classTypeId = existing.id;
    } else {
      const slug =
        classTypeField.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `class-${Date.now()}`;
      const dupe = get<{ id: number }>(`SELECT id FROM class_types WHERE slug = ?`, slug);
      const res = run(
        `INSERT INTO class_types (name, slug, description, active) VALUES (?,?,NULL,1)`,
        classTypeField, dupe ? `${slug}-${Date.now().toString(36)}` : slug
      );
      classTypeId = Number(res.lastInsertRowid);
      audit("class_type.created_inline", { actorType: "admin", actor: admin.email, entityType: "class_type", entityId: classTypeId, detail: { name: classTypeField } });
    }
  }
  const instructorId = Number(formData.get("instructorId")) || null;
  const venueField = String(formData.get("venueId") ?? "").trim();
  if (venueField === "__new__") {
    redirect("/admin/classes/new?error=Type+the+new+venue+name+in+the+box+that+appeared");
  }
  let venueId: number | null = /^\d+$/.test(venueField) ? Number(venueField) : null;
  if (venueId === null && venueField) {
    const maps = String(formData.get("venueMapUrl") ?? "").trim();
    const mapUrl = maps.startsWith("https://") ? maps : null;
    const existingVenue = get<{ id: number }>(`SELECT id FROM venues WHERE name = ? COLLATE NOCASE`, venueField);
    if (existingVenue) {
      venueId = existingVenue.id;
    } else {
      const res = run(`INSERT INTO venues (name, map_url, active) VALUES (?,?,1)`, venueField, mapUrl);
      venueId = Number(res.lastInsertRowid);
      audit("venue.created_inline", { actorType: "admin", actor: admin.email, entityType: "venue", entityId: venueId, detail: { name: venueField } });
    }
  }
  const res = run(
    `INSERT INTO class_series (title, class_type_id, venue_id, instructor_id, weekdays, start_time, end_time, capacity, price_override_cents, waitlist_enabled, skip_dates, publication_status)
     VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`,
    title, classTypeId, venueId, instructorId, JSON.stringify(weekdays), startTime, endTime, capacity, priceOverride,
    skipDates.length ? JSON.stringify(skipDates) : null, publicationStatus
  );
  const seriesId = Number(res.lastInsertRowid);
  const slots = generateOccurrences({ weekdays, startTime, endTime, fromDate, toDate, tz: settings.timezone, skipDates });
  let created = 0;
  for (const s of slots) {
    const exists = get(`SELECT id FROM class_occurrences WHERE series_id = ? AND starts_at = ?`, seriesId, s.startsAt);
    if (!exists) {
      run(
        `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, price_override_cents, waitlist_enabled, publication_status, source)
         VALUES (?,?,?,?,?,?,?,?,?,1,?,'series')`,
        seriesId, classTypeId, venueId, instructorId, title.split("-")[0].trim() || title, s.startsAt, s.endsAt, capacity, priceOverride, publicationStatus
      );
      created++;
    }
  }
  audit("series.created", { actorType: "admin", actor: admin.email, entityType: "series", entityId: seriesId, detail: { created, fromDate, toDate } });
  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  redirect(`/admin/classes/new?created=${created}`);
}

export async function addOccurrenceAction(formData: FormData) {
  const admin = await guardWrite();
  const date = String(formData.get("date") ?? "");
  const start = String(formData.get("startTime") ?? "19:30");
  const end = String(formData.get("endTime") ?? "20:30");
  if (!date) redirect("/admin/classes?error=Date+is+required");
  const settings = await getSettings();
  const publicationStatus = formData.get("publicationStatus") === "published" ? "published" : "draft";
  const [y, m, d] = date.split("-").map(Number);
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const { zonedToUtc } = await import("@/lib/tz");
  const startsAt = zonedToUtc(y, m, d, sh, sm, settings.timezone);
  const endsAt = zonedToUtc(y, m, d, eh, em, settings.timezone);
  const priceOverride = parseEuroInputToCents(String(formData.get("priceOverride") ?? ""));
  const res = run(
    `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, price_override_cents, waitlist_enabled, publication_status, notes_public, notes_admin, source)
     VALUES (NULL,?,?,?,?,?,?,?,?,1,?,?,?,'manual')`,
    Number(formData.get("classTypeId")) || null,
    Number(formData.get("venueId")) || null,
    Number(formData.get("instructorId")) || null,
    String(formData.get("title") ?? "Special class"),
    startsAt, endsAt,
    Math.max(1, Number(formData.get("capacity") ?? 12)),
    priceOverride,
    publicationStatus,
    String(formData.get("notesPublic") ?? "") || null,
    String(formData.get("notesAdmin") ?? "") || null
  );
  audit("occurrence.created", { actorType: "admin", actor: admin.email, entityType: "occurrence", entityId: Number(res.lastInsertRowid) });
  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  redirect("/admin/classes/new?created=1");
}

export async function updateOccurrenceAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const occ = get<{ capacity: number; status: string; series_id: number | null; publication_status: string }>(`SELECT capacity, status, series_id, publication_status FROM class_occurrences WHERE id = ?`, id);
  if (!occ) redirect("/admin/classes?error=Class+not+found");
  const publicationStatus = formData.get("publicationStatus") === "published" ? "published" : "draft";
  if (!occ.series_id && occ.publication_status === "published" && publicationStatus === "draft") {
    const usage = get<{ bookings: number; holds: number }>(
      `SELECT
         (SELECT COUNT(*) FROM bookings WHERE occurrence_id = ?) AS bookings,
         (SELECT COUNT(*) FROM capacity_holds h JOIN orders ord ON ord.id = h.order_id WHERE h.occurrence_id = ? AND h.released = 0 AND h.expires_at > ? AND ord.status IN ('pending','awaiting_payment')) AS holds`,
      id, id, nowIso()
    )!;
    if (usage.bookings > 0 || usage.holds > 0) redirect(`/admin/classes/${id}?error=A+class+with+bookings+or+active+checkouts+must+stay+published`);
  }
  const settings = await getSettings();
  const date = String(formData.get("date") ?? "");
  const start = String(formData.get("startTime") ?? "19:30");
  const end = String(formData.get("endTime") ?? "20:30");
  const [y, m, d] = date.split("-").map(Number);
  const { zonedToUtc } = await import("@/lib/tz");
  const startsAt = zonedToUtc(y, m, d, ...start.split(":").map(Number) as [number, number], settings.timezone);
  const endsAt = zonedToUtc(y, m, d, ...end.split(":").map(Number) as [number, number], settings.timezone);
  const capacity = Math.max(1, Number(formData.get("capacity") ?? occ.capacity));
  const confirmed = get<{ c: number }>(`SELECT COALESCE(SUM(seat_count),0) AS c FROM bookings WHERE occurrence_id = ? AND status IN ('confirmed','attended')`, id)!.c;
  if (capacity < confirmed) {
    redirect(`/admin/classes/${id}?error=Capacity+cannot+be+below+confirmed+bookings+(${confirmed})`);
  }
  const priceOverride = parseEuroInputToCents(String(formData.get("priceOverride") ?? ""));
  run(
    `UPDATE class_occurrences SET title = ?, starts_at = ?, ends_at = ?, capacity = ?, price_override_cents = ?, waitlist_enabled = ?, publication_status = CASE WHEN series_id IS NULL THEN ? ELSE publication_status END, notes_public = ?, notes_admin = ?, updated_at = ? WHERE id = ?`,
    String(formData.get("title") ?? "Class"),
    startsAt, endsAt, capacity, priceOverride,
    formData.get("waitlist") === "on" ? 1 : 0,
    publicationStatus,
    String(formData.get("notesPublic") ?? "") || null,
    String(formData.get("notesAdmin") ?? "") || null,
    nowIso(), id
  );
  audit("occurrence.updated", { actorType: "admin", actor: admin.email, entityType: "occurrence", entityId: id, detail: { capacity } });
  revalidatePath(`/admin/classes/${id}`);
  revalidatePath("/classes");
  redirect(`/admin/classes/${id}?saved=1`);
}

export async function cancelOccurrenceAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const occ = get<{ status: string }>(`SELECT status FROM class_occurrences WHERE id = ?`, id);
  if (!occ || occ.status === "cancelled") redirect("/admin/classes");
  // domain operation: settles pass credits, flags online refunds, invalidates
  // the waitlist, sends exactly one email per attendee. Safe to repeat.
  const res = await cancelOccurrence(id, admin.email, "Class cancelled by the organiser");
  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  redirect(`/admin/classes?cancelled=1&notified=${res.notified}`);
}

export async function notifyOccurrenceAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const message = String(formData.get("message") ?? "").trim();
  if (!message) redirect(`/admin/classes/${id}?error=Write+a+message+first`);
  const occ = get<{ title: string; starts_at: string }>(`SELECT title, starts_at FROM class_occurrences WHERE id = ?`, id);
  if (!occ) redirect("/admin/classes");
  const attendees = all<{ email: string; name: string | null }>(
    `SELECT c.email, c.name FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.occurrence_id = ? AND b.status = 'confirmed'`,
    id
  );
  for (const a of attendees) {
    await sendTemplate("class_changed", a.email, {
      customer_name: a.name ?? "there",
      class_title: occ.title,
      class_when: "your upcoming class",
      change_message: message,
    }, { relatedType: "occurrence", relatedId: id });
  }
  audit("occurrence.notified", { actorType: "admin", actor: admin.email, entityType: "occurrence", entityId: id, detail: { recipients: attendees.length } });
  redirect(`/admin/classes/${id}?notified=${attendees.length}`);
}

// ---------- Bookings ----------

export async function adminBookingAction(formData: FormData) {
  const admin = await guardWrite();
  const res = await adminCreateBooking({
    occurrenceId: Number(formData.get("occurrenceId")),
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? "") || null,
    paymentMethod: String(formData.get("paymentMethod") ?? "cash") as "recorded" | "cash" | "transfer" | "complimentary",
    amountCents: parseEuroInputToCents(String(formData.get("amount") ?? "")),
    noteAdmin: String(formData.get("note") ?? "") || null,
    actor: admin.email,
  });
  if (!res.ok) redirect(`/admin/bookings?error=${encodeURIComponent(res.error ?? "Could not add booking")}`);
  revalidatePath("/admin/bookings");
  redirect(`/admin/bookings?added=1`);
}

export async function adminBlockBookingAction(formData: FormData) {
  const admin = await guardWrite();
  const offering = String(formData.get("offering") ?? "");
  const [kind, rawId] = offering.split(":");
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0 || (kind !== "block" && kind !== "bundle")) {
    redirect("/admin/bookings?error=Choose+a+block+or+bundle");
  }
  const attendeeNames = String(formData.get("attendeeNames") ?? "").split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  const block = kind === "block" ? get<{ kind: string }>(`SELECT kind FROM class_blocks WHERE id = ?`, id) : null;
  const eventBooking = block?.kind === "workshop" || block?.kind === "retreat";
  if (eventBooking && attendeeNames.length === 0) redirect("/admin/bookings?error=Enter+at+least+one+attendee+name");
  if (eventBooking && attendeeNames.length > 20) redirect("/admin/bookings?error=Event+bookings+are+limited+to+20+attendees");
  const result = await adminCreateBlockBooking({
    blockId: kind === "block" ? id : null,
    bundleId: kind === "bundle" ? id : null,
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    attendeeNames: eventBooking ? attendeeNames : undefined,
    phone: String(formData.get("phone") ?? "") || null,
    paymentMethod: String(formData.get("paymentMethod") ?? "cash") as "recorded" | "cash" | "transfer" | "complimentary",
    amountCents: parseEuroInputToCents(String(formData.get("amount") ?? "")),
    noteAdmin: String(formData.get("note") ?? "") || null,
    actor: admin.email,
  });
  if (!result.ok) redirect(`/admin/bookings?error=${encodeURIComponent(result.error ?? "Could+not+add+block+booking")}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/classes");
  redirect(`/admin/bookings?added=1&count=${result.eventBooking ? result.seatCount ?? 0 : result.bookingCount ?? 0}&event=${result.eventBooking ? 1 : 0}`);
}

export async function markAttendanceAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") ?? "attended");
  run(`UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?`, status === "attended" ? "attended" : "no_show", nowIso(), id);
  audit("attendance.marked", { actorType: "admin", actor: admin.email, entityType: "booking", entityId: id, detail: { status } });
  revalidatePath(`/admin/bookings/attendance/${Number(formData.get("occurrenceId"))}`);
}

export async function cancelBookingAdminAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const reason = String(formData.get("reason") ?? "") || "Cancelled by Anne";
  const notify = formData.get("notify") === "on";
  const booking = get<{ customer_id: number }>(`SELECT customer_id FROM bookings WHERE id = ?`, id);
  if (!booking) redirect("/admin/bookings?error=Booking+not+found");
  // the domain operation settles money/credits and sends exactly ONE notification
  await cancelBooking(id, admin.email, "admin", reason, { notify });
  void notify;
  revalidatePath("/admin/bookings");
  redirect("/admin/bookings?cancelled=1");
}

export async function transferEventBookingAction(formData: FormData) {
  const admin = await guardWrite();
  const bookingId = Number(formData.get("bookingId"));
  const targetOccurrenceId = Number(formData.get("targetOccurrenceId"));
  const attendeeNames = String(formData.get("attendeeNames") ?? "").split(/\r?\n/);
  const paymentMethod = String(formData.get("paymentMethod") ?? "");
  const allowedMethods = ["cash", "transfer", "recorded"];
  const result = transferEventBooking({
    bookingId,
    targetOccurrenceId,
    attendeeNames,
    paymentMethod: allowedMethods.includes(paymentMethod) ? paymentMethod as "cash" | "transfer" | "recorded" : undefined,
    actor: admin.email,
    note: String(formData.get("note") ?? "").trim() || null,
  });
  if (!result.ok) redirect(`/admin/bookings?error=${encodeURIComponent(result.error)}`);

  const details = get<{ email: string; name: string | null; title: string; starts_at: string }>(
    `SELECT c.email, c.name, o.title, o.starts_at FROM bookings b
     JOIN customers c ON c.id = b.customer_id JOIN class_occurrences o ON o.id = b.occurrence_id WHERE b.id = ?`,
    bookingId
  );
  if (details) {
    const settings = await getSettings();
    await sendTemplate("class_changed", details.email, {
      customer_name: details.name ?? "there",
      class_title: details.title,
      class_when: fmtDateTime(details.starts_at, details.starts_at, settings.timezone),
      change_message: `Your group booking has been transferred to ${details.title}.${result.refundDueCents > 0 ? ` A refund of ${fmtEuro(result.refundDueCents)} is due; Anne will arrange it using your original payment method where possible.` : ""}`,
    }, { relatedType: "booking", relatedId: bookingId });
  }
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  redirect(`/admin/bookings?transferred=1${result.refundDueCents > 0 ? `&refundDue=${result.refundDueCents}` : ""}`);
}

export async function recordOfflinePaymentAction(formData: FormData) {
  const admin = await guardWrite();
  const bookingId = Number(formData.get("bookingId"));
  const method = String(formData.get("method") ?? "cash");
  const amount = parseEuroInputToCents(String(formData.get("amount") ?? "")) ?? 0;
  const note = String(formData.get("note") ?? "") || null;
  const booking = get<{ order_id: number | null; customer_id: number; price_cents: number }>(`SELECT order_id, customer_id, price_cents FROM bookings WHERE id = ?`, bookingId);
  if (!booking) redirect("/admin/bookings?error=Booking+not+found");
  let orderId = booking.order_id;
  if (!orderId) {
    const ref = `YA-ADMIN-${bookingId}`;
    const existing = get<{ id: number }>(`SELECT id FROM orders WHERE ref = ?`, ref);
    if (existing) {
      orderId = existing.id;
    } else {
      const res = run(
        `INSERT INTO orders (ref, customer_id, status, subtotal_cents, total_cents, offline, checkout_mode, paid_at, created_at, updated_at)
         VALUES (?,?, 'paid', ?, ?, 1, 'offline', ?, ?, ?)`,
        ref, booking.customer_id, amount || booking.price_cents, amount || booking.price_cents, nowIso(), nowIso(), nowIso()
      );
      orderId = Number(res.lastInsertRowid);
      run(`UPDATE bookings SET order_id = ? WHERE id = ?`, orderId, bookingId);
    }
  }
  run(
    `INSERT INTO payments (order_id, provider, provider_ref, amount_cents, status, method, note_admin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    orderId, "offline", `offline-${orderId}-${Date.now()}`, amount, "succeeded", method, note, nowIso(), nowIso()
  );
  audit("payment.recorded", { actorType: "admin", actor: admin.email, entityType: "booking", entityId: bookingId, detail: { method, amount } });
  revalidatePath("/admin/bookings");
  redirect("/admin/bookings?payment=1");
}

export async function refundPaymentAction(formData: FormData) {
  const admin = await guardWrite();
  const paymentId = Number(formData.get("paymentId"));
  const eventTransferIdRaw = String(formData.get("eventTransferId") ?? "").trim();
  const eventTransferId = eventTransferIdRaw ? Number(eventTransferIdRaw) : undefined;
  const amount = parseEuroInputToCents(String(formData.get("amount") ?? "")) ?? 0;
  const reason = String(formData.get("reason") ?? "Refund");
  const payment = get<{ order_id: number; provider: string; provider_ref: string | null; amount_cents: number; status: string }>(`SELECT * FROM payments WHERE id = ?`, paymentId);
  if (!payment) redirect("/admin/bookings?error=Payment+not+found");
  if (amount <= 0) redirect("/admin/bookings?error=Enter+a+refund+amount+greater+than+zero");
  if (eventTransferIdRaw && (!Number.isInteger(eventTransferId) || eventTransferId! < 1)) redirect("/admin/bookings?error=Invalid+event+transfer");

  let providerRef: string | null = null;
  if (payment.provider === "stripe") {
    if (!payment.provider_ref?.startsWith("pi_") || !stripeEnabled()) {
      redirect("/admin/bookings?error=Stripe+refunds+are+unavailable+for+this+payment");
    }
    const remaining = remainingRefundable(paymentId);
    if (amount > remaining) {
      redirect(`/admin/bookings?error=${encodeURIComponent(`Only ${(remaining / 100).toFixed(2)} of this payment remains refundable`)}`);
    }
    const res = await createStripeRefund(payment.provider_ref, amount, reason);
    if (!res.ok) redirect(`/admin/bookings?error=${encodeURIComponent(`Stripe refund failed: ${res.error}`)}`);
    providerRef = res.refundId ?? null; // persist the REAL Stripe refund id
  }
  const result = recordRefund(paymentId, amount, admin.email, reason, { provider: payment.provider, providerRef, eventTransferId });
  if (!result.ok) redirect(`/admin/bookings?error=${encodeURIComponent(result.error)}`);
  revalidatePath("/admin/bookings");
  redirect("/admin/bookings?refunded=1");
}

export async function adjustPassCreditAction(formData: FormData) {
  const admin = await guardWrite();
  const passId = Number(formData.get("passId"));
  const delta = Number(formData.get("delta") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!passId || !delta || !reason) redirect("/admin/customers?error=Pass,+amount+and+reason+are+required");
  run(`INSERT INTO pass_credit_ledger (pass_id, delta, reason, actor, note, created_at) VALUES (?,?,?,?,?,?)`,
    passId, delta, "admin_adjustment", admin.email, reason, nowIso());
  audit("pass.credit_adjusted", { actorType: "admin", actor: admin.email, entityType: "pass", entityId: passId, detail: { delta, reason } });
  redirect("/admin/customers?pass=1");
}

// ---------- Jobs ----------

export async function runJobsAction() {
  const admin = await guard();
  releaseExpiredHolds();
  expireWaitlistOffers();
  const settings = await getSettings();
  const horizon = new Date(Date.now() + settings.reminder_hours * 3600 * 1000).toISOString();
  const due = all<{ id: number; occurrence_id: number; customer_id: number }>(
    `SELECT b.id, b.occurrence_id, b.customer_id FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id
     WHERE b.status = 'confirmed' AND b.reminder_sent_at IS NULL AND o.starts_at > ? AND o.starts_at <= ? AND o.status = 'scheduled'`,
    nowIso(), horizon
  );
  let sent = 0;
  for (const b of due) {
    const occ = get<{ title: string; starts_at: string; ends_at: string; venue_id: number | null }>(`SELECT * FROM class_occurrences WHERE id = ?`, b.occurrence_id);
    const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, b.customer_id);
    if (!occ || !customer) continue;
    const venue = occ.venue_id ? get<{ name: string; address: string | null }>(`SELECT name, address FROM venues WHERE id = ?`, occ.venue_id) : null;
    await sendTemplate("class_reminder", customer.email, {
      customer_name: customer.name ?? "there",
      class_title: occ.title,
      class_when: fmtWhen(occ.starts_at, occ.ends_at, settings.timezone),
      venue_details: venue ? `${venue.name}${venue.address ? ", " + venue.address : ""}` : "",
    }, { relatedType: "booking", relatedId: b.id });
    run(`UPDATE bookings SET reminder_sent_at = ? WHERE id = ?`, nowIso(), b.id);
    sent++;
  }
  audit("jobs.ran", { actorType: "admin", actor: admin.email, detail: { reminders: sent } });
  revalidatePath("/admin");
  redirect(`/admin?jobs=reminders:${sent}`);
}

function fmtWhen(starts: string, ends: string, tz: string): string {
  return fmtDateTime(starts, ends, tz);
}

// ---------- Pricing ----------

export async function saveProductAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim();
  const price = parseEuroInputToCents(String(formData.get("price") ?? ""));
  if (!name || price === null) redirect("/admin/pricing?error=Name+and+price+are+required");
  const kind = String(formData.get("kind") ?? "pass");
  const pricingSettings = await getSettings();
  if (kind === "pass" && !pricingSettings.class_passes_enabled) redirect("/admin/pricing?error=Class+passes+are+disabled+for+this+site");
  if (kind === "membership" && !pricingSettings.memberships_enabled) redirect("/admin/pricing?error=Memberships+are+disabled+for+this+site");
  const credits = Number(formData.get("credits")) || null;
  const validityWeeks = Number(formData.get("validityWeeks")) || null;
  const recurrence = String(formData.get("recurrence") ?? "") || null;
  const description = String(formData.get("description") ?? "") || null;
  const eligibility = String(formData.get("eligibility") ?? "all");
  const active = formData.get("active") === "on" ? 1 : 0;
  if (id) {
    run(`UPDATE products SET name=?, description=?, price_cents=?, credits=?, validity_weeks=?, recurrence=?, eligibility=?, active=?, updated_at=? WHERE id=?`,
      name, description, price, credits, validityWeeks, recurrence, eligibility, active, nowIso(), id);
    audit("product.updated", { actorType: "admin", actor: admin.email, entityType: "product", entityId: id });
  } else {
    const res = run(`INSERT INTO products (kind, name, description, price_cents, credits, validity_weeks, eligibility, recurrence, active, sort) VALUES (?,?,?,?,?,?,?,?,?,99)`,
      kind, name, description, price, credits, validityWeeks, eligibility, recurrence, active);
    audit("product.created", { actorType: "admin", actor: admin.email, entityType: "product", entityId: Number(res.lastInsertRowid) });
  }
  revalidatePath("/admin/pricing");
  revalidatePath("/prices");
  redirect("/admin/pricing?saved=1");
}

export async function toggleProductAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const product = get<{ kind: string }>(`SELECT kind FROM products WHERE id = ?`, id);
  const settings = await getSettings();
  if (product?.kind === "pass" && !settings.class_passes_enabled) redirect("/admin/pricing?error=Class+passes+are+disabled+for+this+site");
  if (product?.kind === "membership" && !settings.memberships_enabled) redirect("/admin/pricing?error=Memberships+are+disabled+for+this+site");
  run(`UPDATE products SET active = 1 - active, updated_at = ? WHERE id = ?`, nowIso(), id);
  audit("product.toggled", { actorType: "admin", actor: admin.email, entityType: "product", entityId: id });
  revalidatePath("/admin/pricing");
  revalidatePath("/prices");
}

export async function saveDiscountRuleAction(formData: FormData) {
  const admin = await guardWrite();
  if (!(await getSettings()).multi_date_discount_enabled) redirect("/admin/pricing?error=Multi-date+discounts+are+disabled+for+this+site");
  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim() || "Multi-date rate";
  const min = Math.max(2, Number(formData.get("minDates") ?? 2));
  const max = Math.max(min, Number(formData.get("maxDates") ?? 4));
  const perClass = parseEuroInputToCents(String(formData.get("perClass") ?? ""));
  const active = formData.get("active") === "on" ? 1 : 0;
  if (perClass === null) redirect("/admin/pricing?error=Per-class+price+is+required");
  if (id) {
    run(`UPDATE discount_rules SET name=?, min_distinct_dates=?, max_distinct_dates=?, per_class_cents=?, active=?, updated_at=? WHERE id=?`,
      name, min, max, perClass, active, nowIso(), id);
  } else {
    run(`INSERT INTO discount_rules (name, min_distinct_dates, max_distinct_dates, per_class_cents, active) VALUES (?,?,?,?,?)`, name, min, max, perClass, active);
  }
  audit("discount_rule.saved", { actorType: "admin", actor: admin.email, entityType: "discount_rule", entityId: id ?? "new" });
  revalidatePath("/admin/pricing");
  revalidatePath("/prices");
  redirect("/admin/pricing?saved=1");
}

export async function saveCouponAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id")) || null;
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const kind = String(formData.get("kind") ?? "percent");
  const rawValue = String(formData.get("value") ?? "");
  const value = kind === "percent" ? Math.min(100, Math.max(0, Number(rawValue) || 0)) : parseEuroInputToCents(rawValue) ?? 0;
  const minTotal = parseEuroInputToCents(String(formData.get("minTotal") ?? "")) ?? 0;
  const maxRedemptions = Number(formData.get("maxRedemptions")) || null;
  const active = formData.get("active") === "on" ? 1 : 0;
  if (!code) redirect("/admin/pricing?error=Coupon+code+is+required");
  if (id) {
    run(`UPDATE coupons SET code=?, kind=?, value=?, min_total_cents=?, max_redemptions=?, active=?, updated_at=? WHERE id=?`,
      code, kind, value, minTotal, maxRedemptions, active, nowIso(), id);
  } else {
    const existing = get(`SELECT id FROM coupons WHERE code = ?`, code);
    if (existing) redirect("/admin/pricing?error=A+coupon+with+that+code+already+exists");
    run(`INSERT INTO coupons (code, kind, value, min_total_cents, max_redemptions, active) VALUES (?,?,?,?,?,?)`,
      code, kind, value, minTotal, maxRedemptions, active);
  }
  audit("coupon.saved", { actorType: "admin", actor: admin.email, entityType: "coupon", entityId: id ?? code });
  revalidatePath("/admin/pricing");
  redirect("/admin/pricing?saved=1");
}

// ---------- Content ----------

export async function saveContentAction(formData: FormData) {
  const admin = await guardSuper();
  const page = String(formData.get("page") ?? "");
  const key = String(formData.get("key") ?? "");
  const type = String(formData.get("type") ?? "text");
  const raw = String(formData.get("value") ?? "");
  let value: unknown = raw;
  if (type === "list") value = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  if (type === "pairs") {
    value = {
      intro: String(formData.get("intro") ?? ""),
      items: formData.getAll("itemTitle").map((t, i) => [String(t), String(formData.getAll("itemBody")[i] ?? "")]).filter(([t]) => t.trim()),
    };
  }
  if (page && key) {
    await setContent(page, key, value as never);
    audit("content.updated", { actorType: "admin", actor: admin.email, entityType: "content", entityId: `${page}.${key}` });
  }
  revalidatePath("/", "layout");
  redirect(`/admin/content?saved=${page}.${key}`);
}

export async function saveHomepageHeroButtonsAction(formData: FormData) {
  const admin = await guardSuper();
  const button = (prefix: "primary" | "secondary") => ({
    label: String(formData.get(`${prefix}Label`) ?? "").trim().slice(0, 80),
    href: String(formData.get(`${prefix}Href`) ?? "").trim(),
    active: formData.get(`${prefix}Active`) === "on" ? "true" : "false",
  });
  const buttons = { primary: button("primary"), secondary: button("secondary") };
  const invalid = Object.values(buttons).some(({ label, href }) =>
    !label || !href.startsWith("/") || href.startsWith("//") || /[\s<>"']/.test(href)
  );
  if (invalid) redirect("/admin/content?error=Each+hero+button+needs+a+label+and+internal+URL");
  for (const [name, config] of Object.entries(buttons)) {
    const customPageSlug = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(config.href)?.[1];
    const fixedRoutes = ["/", "/classes", "/workshops", "/prices", "/about", "/contact", "/enquire", "/faqs", "/#new-here"];
    if (!fixedRoutes.includes(config.href) && (!customPageSlug || !get(`SELECT id FROM site_pages WHERE slug = ? AND status = 'published'`, customPageSlug))) {
      redirect(`/admin/content?error=${name}+button+must+link+to+a+built-in+or+published+page`);
    }
    await setContent("home", `hero_${name}_button`, config);
  }
  audit("homepage.hero_buttons_updated", { actorType: "admin", actor: admin.email });
  revalidatePath("/");
  redirect("/admin/content?saved=hero-buttons");
}

export async function saveHomepageLayoutAction(formData: FormData) {
  const admin = await guardSuper();
  const { HOMEPAGE_SECTION_DEFINITIONS } = await import("@/lib/homepage");
  const sections = HOMEPAGE_SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
    active: formData.get(`${section.id}_active`) === "on",
    sort: Number(formData.get(`${section.id}_sort`)),
  }));
  const orders = sections.map((section) => section.sort);
  if (sections.some((section) => !Number.isInteger(section.sort) || section.sort < 1 || section.sort > sections.length) ||
    new Set(orders).size !== sections.length) {
    redirect("/admin/content?error=Give+each+homepage+section+a+unique+order+from+1+to+11");
  }
  await setSetting("homepage_sections", sections);
  audit("homepage.layout_updated", { actorType: "admin", actor: admin.email, detail: { sections } });
  revalidatePath("/");
  redirect("/admin/content?saved=homepage-layout");
}

export async function saveFaqAction(formData: FormData) {
  const admin = await guardSuper();
  const id = Number(formData.get("id")) || null;
  const question = String(formData.get("question") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  const published = formData.get("published") === "on" ? 1 : 0;
  if (!question || !answer) redirect("/admin/content?error=Question+and+answer+required");
  if (id) {
    run(`UPDATE faqs SET question=?, answer=?, published=?, updated_at=? WHERE id=?`, question, answer, published, nowIso(), id);
  } else {
    run(`INSERT INTO faqs (question, answer, published, sort) VALUES (?,?,?,99)`, question, answer, published);
  }
  audit("faq.saved", { actorType: "admin", actor: admin.email, entityType: "faq", entityId: id ?? "new" });
  revalidatePath("/admin/content");
  revalidatePath("/faqs");
  redirect("/admin/content?saved=faq");
}

export async function deleteFaqAction(formData: FormData) {
  await guardSuper();
  run(`DELETE FROM faqs WHERE id = ?`, Number(formData.get("id")));
  revalidatePath("/admin/content");
  revalidatePath("/faqs");
}

export async function saveTestimonialAction(formData: FormData) {
  const admin = await guardSuper();
  const id = Number(formData.get("id")) || null;
  const quote = String(formData.get("quote") ?? "").trim();
  const attribution = String(formData.get("attribution") ?? "").trim();
  const consentNote = String(formData.get("consentNote") ?? "").trim();
  const published = formData.get("published") === "on" ? 1 : 0;
  if (!quote) redirect("/admin/content?error=Quote+is+required");
  if (id) {
    run(`UPDATE testimonials SET quote=?, attribution=?, consent_note=?, published=?, updated_at=? WHERE id=?`,
      quote, attribution, consentNote, published, nowIso(), id);
  } else {
    run(`INSERT INTO testimonials (quote, attribution, consent_note, published) VALUES (?,?,?,?)`, quote, attribution, consentNote, published);
  }
  audit("testimonial.saved", { actorType: "admin", actor: admin.email, entityType: "testimonial", entityId: id ?? "new" });
  revalidatePath("/admin/content");
  revalidatePath("/");
  redirect("/admin/content?saved=testimonial");
}

export async function savePolicyAction(formData: FormData) {
  const admin = await guardSuper();
  const slug = String(formData.get("slug") ?? "");
  const body = String(formData.get("body") ?? "");
  const publish = formData.get("publish") === "1";
  const policy = get<{ version: number; status: string; body_md: string }>(`SELECT * FROM policies WHERE slug = ?`, slug);
  if (!policy) redirect("/admin/content?error=Policy+not+found");
  if (publish) {
    run(`UPDATE policies SET body_md=?, status='published', published_at=COALESCE(published_at, ?), updated_at=? WHERE slug=?`,
      body, nowIso(), nowIso(), slug);
  } else {
    run(`UPDATE policies SET body_md=?, updated_at=? WHERE slug=?`, body, nowIso(), slug);
  }
  audit(publish ? "policy.published" : "policy.saved_draft", { actorType: "admin", actor: admin.email, entityType: "policy", entityId: slug });
  revalidatePath("/admin/content");
  revalidatePath(`/policies/${slug}`);
  redirect(`/admin/content?saved=${slug}`);
}

// ---------- Settings ----------

export async function saveSettingsAction(formData: FormData) {
  const admin = await guardSuper();

  const settings = await getSettings();
  const entries: [string, unknown][] = [
    ["business_name", String(formData.get("business_name") ?? settings.business_name)],
    ["contact_email", String(formData.get("contact_email") ?? settings.contact_email)],
    ["contact_phone_display", String(formData.get("contact_phone_display") ?? settings.contact_phone_display)],
    ["phone_intl", String(formData.get("phone_intl") ?? settings.phone_intl)],
    ["whatsapp_greeting", String(formData.get("whatsapp_greeting") ?? settings.whatsapp_greeting)],
    ["facebook_url", String(formData.get("facebook_url") ?? "")],
    ["instagram_url", String(formData.get("instagram_url") ?? "")],
    ["announcement", String(formData.get("announcement") ?? "")],
    ["no_classes_notice", String(formData.get("no_classes_notice") ?? "")],
    ["tax_note", String(formData.get("tax_note") ?? "")],
    ["cancellation_cutoff_hours", Math.max(0, Number(formData.get("cancellation_cutoff_hours") ?? settings.cancellation_cutoff_hours))],
    ["hold_minutes", Math.max(1, Number(formData.get("hold_minutes") ?? settings.hold_minutes))],
    ["reminder_hours", Math.max(1, Number(formData.get("reminder_hours") ?? settings.reminder_hours))],
    ["waitlist_offer_hours", Math.max(1, Number(formData.get("waitlist_offer_hours") ?? settings.waitlist_offer_hours))],
["checkout_enabled", formData.get("checkout_enabled") === "on"],
    ["class_passes_enabled", formData.get("class_passes_enabled") === "on"],
    ["multi_date_discount_enabled", formData.get("multi_date_discount_enabled") === "on"],
    ["memberships_enabled", formData.get("memberships_enabled") === "on"],
    ["maintenance_mode", formData.get("maintenance_mode") === "on"],
  ];
  // media selections (empty string = none)
  const mediaKeys = ["logo_media_id", "hero_media_id", "portrait_media_id", "og_media_id"] as const;
  for (const key of mediaKeys) {
    const raw = String(formData.get(key) ?? "").trim();
    const parsed = raw === "" ? null : Number(raw);
    entries.push([key, parsed && Number.isInteger(parsed) && parsed > 0 ? parsed : null]);
  }
  for (const [k, v] of entries) await setSetting(k, v);
  audit("settings.updated", { actorType: "admin", actor: admin.email });
  revalidatePath("/", "layout");
  redirect("/admin/settings?saved=1");
}

export async function changePasswordAction(formData: FormData) {
  const admin = await guard();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const row = get<{ password_hash: string }>(`SELECT password_hash FROM admins WHERE id = ?`, admin.id)!;
  const { verifyPassword } = await import("@/lib/auth");
  if (!verifyPassword(current, row.password_hash)) redirect("/admin/settings?error=Current+password+is+incorrect");
  if (next.length < 10) redirect("/admin/settings?error=New+password+must+be+at+least+10+characters");
  run(`UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?`, hashPassword(next), nowIso(), admin.id);
  audit("admin.password_changed", { actorType: "admin", actor: admin.email });
  redirect("/admin/settings?password=1");
}

// ---------- Waitlist ----------

export async function offerWaitlistSeatAction(formData: FormData) {
  const admin = await guardWrite();
  const occurrenceId = Number(formData.get("occurrenceId"));
  const ok = await offerNextWaitlistSeat(occurrenceId);
  revalidatePath("/admin/waitlist");
  redirect(`/admin/waitlist?offered=${ok ? 1 : 0}`);
}

export async function expireWaitlistAction() {
  const admin = await guard();
  expireWaitlistOffers();
  revalidatePath("/admin/waitlist");
  redirect("/admin/waitlist?expired=1");
}

// ---------- Customers ----------

export async function anonymiseCustomerAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== "ANONYMISE") redirect(`/admin/customers/${id}?error=Type+ANONYMISE+to+confirm`);
  const customer = get<{ email: string }>(`SELECT email FROM customers WHERE id = ?`, id);
  if (!customer) redirect("/admin/customers");
  tx(() => {
    run(`UPDATE customers SET email = ?, name = NULL, phone = NULL, marketing_consent = 0, anonymised = 1, notes_admin = 'Anonymised at customer request', updated_at = ? WHERE id = ?`,
      `anon-${id}@deleted.invalid`, nowIso(), id);
    run(`DELETE FROM customer_tokens WHERE customer_id = ?`, id);
  });
  audit("customer.anonymised", { actorType: "admin", actor: admin.email, entityType: "customer", entityId: id, detail: { formerEmail: customer.email } });
  redirect("/admin/customers?anonymised=1");
}
