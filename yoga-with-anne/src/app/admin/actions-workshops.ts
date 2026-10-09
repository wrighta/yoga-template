"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { run, get, nowIso, audit } from "@/db";
import { requireAdmin, canWrite } from "@/lib/auth";
import { parseEuroInputToCents } from "@/lib/money";
import { zonedToUtc } from "@/lib/tz";
import { getSettings } from "@/lib/settings";

/**
 * Workshop creation: usually one day (default), optionally a weekend (two
 * consecutive days). One price for the whole workshop, optional early-bird,
 * description + image for the public page. Uses the block engine underneath.
 */
export async function createSmartWorkshopAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");
  if (!canWrite(admin.role)) redirect("/admin/classes/new?error=Your+role+has+read-only+access");

  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "workshop");
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const capacity = Math.max(1, Number(formData.get("capacity") ?? 14));
  const price = parseEuroInputToCents(String(formData.get("price") ?? ""));
  const earlyBirdRaw = String(formData.get("earlyBirdPrice") ?? "").trim();
  const earlyBirdPrice = earlyBirdRaw ? parseEuroInputToCents(earlyBirdRaw) : null;
  const earlyBirdUntil = String(formData.get("earlyBirdUntil") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const imageMediaId = Number(formData.get("imageMediaId")) || null;
  let dailyTimes: string | null = null;
  const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (kind === "workshop") {
    const start = String(formData.get("workshopStartTime") ?? "");
    const end = String(formData.get("workshopEndTime") ?? "");
    if (!validTime(start) || !validTime(end) || start >= end) redirect("/admin/classes/new?error=Enter+valid+workshop+start+and+end+times");
    dailyTimes = JSON.stringify({ mode: "same", start, end });
  }
  if (kind === "retreat") {
    const differentTimes = formData.get("differentTimes") === "on";
    if (differentTimes) {
      const dates = formData.getAll("dailyTimeDate").map(String);
      const starts = formData.getAll("dailyTimeStart").map(String);
      const ends = formData.getAll("dailyTimeEnd").map(String);
      const expectedDates: string[] = [];
      const cursor = new Date(`${startDate}T12:00:00Z`);
      const last = new Date(`${endDate}T12:00:00Z`);
      while (cursor <= last && expectedDates.length < 367) {
        expectedDates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      if (expectedDates.length > 366 || dates.length !== expectedDates.length || starts.length !== expectedDates.length || ends.length !== expectedDates.length ||
        dates.some((date, index) => date !== expectedDates[index] || !validTime(starts[index]) || !validTime(ends[index]) || starts[index] >= ends[index])) {
        redirect("/admin/classes/new?error=Enter+a+valid+start+and+end+time+for+every+retreat+date");
      }
      dailyTimes = JSON.stringify({ mode: "daily", days: dates.map((date, index) => ({ date, start: starts[index], end: ends[index] })) });
    } else {
      const start = String(formData.get("dailyStartTime") ?? "");
      const end = String(formData.get("dailyEndTime") ?? "");
      if (!validTime(start) || !validTime(end) || start >= end) redirect("/admin/classes/new?error=Enter+valid+retreat+start+and+end+times");
      dailyTimes = JSON.stringify({ mode: "same", start, end });
    }
  }
  const publicationStatus = formData.get("publicationStatus") === "published" ? "published" : "draft";
  const skipDates: string[] = [];
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

  // class type / instructor combos (id or typed name)
  const classTypeField = String(formData.get("classTypeId") ?? "").trim();
  const instructorField = String(formData.get("instructorId") ?? "").trim();
  if (classTypeField === "__new__" || instructorField === "__new__") {
    redirect("/admin/classes/new?error=Pick+from+the+list+or+type+a+new+name+-+then+fill+in+the+box+that+appears");
  }
  let classTypeId: number | null = /^\d+$/.test(classTypeField) ? Number(classTypeField) : null;
  if (!classTypeId && classTypeField) {
    const existing = get<{ id: number }>(`SELECT id FROM class_types WHERE name = ? COLLATE NOCASE`, classTypeField);
    if (existing) {
      classTypeId = existing.id;
    } else {
      const slug = classTypeField.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `class-${Date.now()}`;
      const dupe = get<{ id: number }>(`SELECT id FROM class_types WHERE slug = ?`, slug);
      const res = run(`INSERT INTO class_types (name, slug, description, active) VALUES (?,?,NULL,1)`, classTypeField, dupe ? `${slug}-${Date.now().toString(36)}` : slug);
      classTypeId = Number(res.lastInsertRowid);
      audit("class_type.created_inline", { actorType: "admin", actor: admin.email, entityType: "class_type", entityId: classTypeId, detail: { name: classTypeField } });
    }
  }
  let instructorId: number | null = /^\d+$/.test(instructorField) ? Number(instructorField) : null;
  if (!instructorId && instructorField) {
    const existing = get<{ id: number }>(`SELECT id FROM instructors WHERE name = ? COLLATE NOCASE`, instructorField);
    if (existing) {
      instructorId = existing.id;
    } else {
      const res = run(`INSERT INTO instructors (name, active) VALUES (?,1)`, instructorField);
      instructorId = Number(res.lastInsertRowid);
      audit("instructor.created_inline", { actorType: "admin", actor: admin.email, entityType: "instructor", entityId: instructorId, detail: { name: instructorField } });
    }
  }

  if (!name || !startDate || !endDate || endDate < startDate || price === null || price <= 0 || !venueId || !classTypeId || (kind !== "workshop" && kind !== "retreat")) {
    redirect("/admin/classes/new?error=An+event+needs+a+name,+valid+date+range,+venue+and+price");
  }
  if (earlyBirdPrice != null && earlyBirdUntil && earlyBirdUntil < new Date().toISOString().slice(0, 10)) {
    redirect("/admin/classes/new?error=The+early-bird+deadline+is+in+the+past");
  }

  // One inventory occurrence represents the entire event date span.
  const settings = await getSettings();
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const eventStart = zonedToUtc(startYear, startMonth, startDay, 0, 0, settings.timezone);
  const eventEnd = zonedToUtc(endYear, endMonth, endDay, 23, 59, settings.timezone);
  const weekday = new Date(`${startDate}T12:00:00Z`).getUTCDay() || 7;
  const res = run(
    `INSERT INTO class_series (title, class_type_id, venue_id, instructor_id, weekdays, start_time, end_time, capacity, waitlist_enabled, status, publication_status)
     VALUES (?,?,?,?,?,'00:00','23:59',?,1,'retired',?)`,
    name, classTypeId, venueId, instructorId, JSON.stringify([weekday]), capacity, publicationStatus
  );
  const seriesId = Number(res.lastInsertRowid);
  const occurrence = run(
    `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, waitlist_enabled, publication_status, source)
     VALUES (?,?,?,?,?,?,?, ?,1,?,'series')`,
    seriesId, classTypeId, venueId, instructorId, name, eventStart, eventEnd, capacity, publicationStatus
  );

  // the workshop itself - a block with kind 'workshop'
  const blockRes = run(
    `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, kind, description, image_media_id, early_bird_price_cents, early_bird_until, daily_times_json, active, publication_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
    seriesId, name, startDate, endDate, price, JSON.stringify([weekday]), kind, description, imageMediaId, earlyBirdPrice, earlyBirdUntil, dailyTimes, publicationStatus
  );
  audit("workshop.created", {
    actorType: "admin", actor: admin.email, entityType: "class_block", entityId: Number(blockRes.lastInsertRowid),
    detail: { name, kind, startDate, endDate, occurrenceId: Number(occurrence.lastInsertRowid), price, earlyBirdPrice, earlyBirdUntil },
  });
  revalidatePath("/admin/classes");
  revalidatePath("/workshops");
  redirect("/admin/classes?saved=1");
}
