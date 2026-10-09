"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { run, get, nowIso, audit } from "@/db";
import { requireAdmin, canWrite } from "@/lib/auth";
import { parseEuroInputToCents } from "@/lib/money";
import { generateOccurrences } from "@/lib/tz";
import { getSettings } from "@/lib/settings";

/**
 * THE teacher-facing block creation: one form creates everything.
 * Free-typed class types / instructors are created on the fly; the recurring
 * series is auto-generated as an internal detail. The teacher never sees them.
 */
export async function createSmartBlockAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");
  if (!canWrite(admin.role)) redirect("/admin/classes/new?error=Your+role+has+read-only+access");

  const name = String(formData.get("name") ?? "").trim();
  const weekdays = formData.getAll("weekdays").map(Number).filter((n) => n >= 1 && n <= 7);
  const startDate = String(formData.get("startDate") ?? "");
  const endMode = String(formData.get("endMode") ?? "weeks");
  const weeks = Math.max(1, Number(formData.get("weeks") ?? 8));
  let endDate = String(formData.get("endDate") ?? "");
  const skipDates = String(formData.get("skipDates") ?? "")
    .split(/[\s,]+/)
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const capacity = Math.max(1, Number(formData.get("capacity") ?? 12));
  const price = parseEuroInputToCents(String(formData.get("price") ?? ""));
  const publicationStatus = formData.get("publicationStatus") === "published" ? "published" : "draft";
  const startTime = String(formData.get("startTime") ?? "19:30");
  const endTime = String(formData.get("endTime") ?? "20:30");

  // class type / instructor: the combo field posts either an id or a typed name
  const classTypeField = String(formData.get("classTypeId") ?? "").trim();
  const instructorField = String(formData.get("instructorId") ?? "").trim();
  // "__new__" means the dropdown's switch-to-typing option was submitted without
  // the mode actually changing (stale render) - fail closed, never create junk.
  if (classTypeField === "__new__" || instructorField === "__new__") {
    redirect("/admin/classes/new?error=Pick+from+the+list+or+type+a+new+name+-+then+fill+in+the+box+that+appears");
  }
  const venueField = String(formData.get("venueId") ?? "").trim();
  if (venueField === "__new__") {
    redirect("/admin/classes/new?error=Type+the+new+venue+name+in+the+box+that+appeared");
  }
  const resolveClassType = (): number | null => {
    if (/^\d+$/.test(classTypeField)) return Number(classTypeField);
    if (!classTypeField) return null;
    const existing = get<{ id: number }>(`SELECT id FROM class_types WHERE name = ? COLLATE NOCASE`, classTypeField);
    if (existing) return existing.id;
    const slug =
      classTypeField.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `class-${Date.now()}`;
    const dupe = get<{ id: number }>(`SELECT id FROM class_types WHERE slug = ?`, slug);
    const res = run(
      `INSERT INTO class_types (name, slug, description, active) VALUES (?,?,NULL,1)`,
      classTypeField, dupe ? `${slug}-${Date.now().toString(36)}` : slug
    );
    audit("class_type.created_inline", { actorType: "admin", actor: admin.email, entityType: "class_type", entityId: Number(res.lastInsertRowid), detail: { name: classTypeField } });
    return Number(res.lastInsertRowid);
  };
  const resolveInstructor = (): number | null => {
    if (/^\d+$/.test(instructorField)) return Number(instructorField);
    if (!instructorField) return null;
    const existing = get<{ id: number }>(`SELECT id FROM instructors WHERE name = ? COLLATE NOCASE`, instructorField);
    if (existing) return existing.id;
    const res = run(`INSERT INTO instructors (name, active) VALUES (?,1)`, instructorField);
    audit("instructor.created_inline", { actorType: "admin", actor: admin.email, entityType: "instructor", entityId: Number(res.lastInsertRowid), detail: { name: instructorField } });
    return Number(res.lastInsertRowid);
  };
  const classTypeId = resolveClassType();
  const instructorId = resolveInstructor();

  // venue: numeric id = existing; otherwise a typed venue name (+ optional maps link) creates it
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
  if (!venueId) {
    redirect("/admin/classes/new?error=Choose+or+type+a+venue");
  }

  if (!name || weekdays.length === 0 || !startDate || price === null || price <= 0) {
    redirect("/admin/classes/new?error=A+block+needs+a+name,+at+least+one+day+and+a+price");
  }
  if (endMode === "weeks") {
    const end = new Date(`${startDate}T00:00:00`);
    end.setDate(end.getDate() + weeks * 7 - 1);
    endDate = end.toISOString().slice(0, 10);
  }
  if (!endDate || endDate < startDate) {
    redirect("/admin/classes/new?error=The+block+cannot+end+before+it+starts");
  }

  if (!classTypeId) {
    redirect("/admin/classes/new?error=Choose+or+type+a+class+type");
  }

  // auto-create the recurring series (internal detail - the teacher never sees this step)
  const settings = await getSettings();
  const res = run(
    `INSERT INTO class_series (title, class_type_id, venue_id, instructor_id, weekdays, start_time, end_time, capacity, waitlist_enabled, publication_status)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
    name, classTypeId, venueId, instructorId, JSON.stringify(weekdays), startTime, endTime, capacity, publicationStatus
  );
  const seriesId = Number(res.lastInsertRowid);

  // generate the block's class dates
  const slots = generateOccurrences({ weekdays, startTime, endTime, fromDate: startDate, toDate: endDate, tz: settings.timezone, skipDates });
  if (slots.length === 0) {
    run(`DELETE FROM class_series WHERE id = ?`, seriesId);
    redirect("/admin/classes/new?error=No+classes+fall+between+those+dates+-+check+the+days+and+skip+dates");
  }
  for (const s of slots) {
    run(
      `INSERT OR IGNORE INTO class_occurrences (series_id, class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, waitlist_enabled, publication_status, source)
       VALUES (?,?,?,?,?,?,?,?,1,?,'series')`,
      seriesId, classTypeId, venueId, instructorId, name, s.startsAt, s.endsAt, capacity, publicationStatus
    );
  }

  // the block itself - on sale immediately
  const blockRes = run(
    `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, active, publication_status) VALUES (?,?,?,?,?,?,1,?)`,
    seriesId, name, startDate, endDate, price, JSON.stringify(weekdays), publicationStatus
  );
  audit("block.created_smart", {
    actorType: "admin", actor: admin.email, entityType: "class_block", entityId: Number(blockRes.lastInsertRowid),
    detail: { name, classes: slots.length, startDate, endDate, price, publicationStatus },
  });
  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  redirect("/admin/classes?saved=1");
}
