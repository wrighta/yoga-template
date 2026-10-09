"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { all, run, get, nowIso, audit, tx } from "@/db";
import { requireAdmin, canWrite } from "@/lib/auth";
import { parseEuroInputToCents } from "@/lib/money";
import { addDaysLocal, generateOccurrences } from "@/lib/tz";

async function guardWrite() {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");
  if (!canWrite(admin.role)) throw new Error("Your role has read-only access.");
  return admin;
}

// ---------- Venues ----------

export async function saveVenueAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin/venues?error=Please+give+the+venue+a+name");
  const values = [
    name,
    String(formData.get("address") ?? "") || null,
    String(formData.get("postcode") ?? "") || null,
    String(formData.get("map_url") ?? "") || null,
    String(formData.get("directions") ?? "") || null,
    String(formData.get("parking_notes") ?? "") || null,
    String(formData.get("access_notes") ?? "") || null,
    formData.get("active") === "on" ? 1 : 0,
  ];
  if (id) {
    run(`UPDATE venues SET name=?, address=?, postcode=?, map_url=?, directions=?, parking_notes=?, access_notes=?, active=? WHERE id=?`,
      ...values, id);
    audit("venue.updated", { actorType: "admin", actor: admin.email, entityType: "venue", entityId: id });
  } else {
    const res = run(`INSERT INTO venues (name, address, postcode, map_url, directions, parking_notes, access_notes, active) VALUES (?,?,?,?,?,?,?,?)`, ...values);
    audit("venue.created", { actorType: "admin", actor: admin.email, entityType: "venue", entityId: Number(res.lastInsertRowid) });
  }
  revalidatePath("/admin/venues");
  redirect("/admin/venues?saved=1");
}

// ---------- Class types ----------

export async function saveClassTypeAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin/class-types?error=Please+give+the+class+a+name");
  const slugBase = String(formData.get("slug") ?? "").trim() || name;
  const slug = slugBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `class-${Date.now()}`;
  const duration = Math.max(15, Number(formData.get("duration") ?? 60));
  const imageRaw = String(formData.get("image_media_id") ?? "").trim();
  const image = imageRaw === "" ? null : Number(imageRaw) || null;
  const values = [
    name,
    String(formData.get("description") ?? "") || null,
    String(formData.get("suitability") ?? "") || null,
    String(formData.get("what_to_bring") ?? "") || null,
    String(formData.get("accessibility_note") ?? "") || null,
    duration,
    image,
    formData.get("active") === "on" ? 1 : 0,
  ];
  try {
    if (id) {
      run(`UPDATE class_types SET name=?, description=?, suitability=?, what_to_bring=?, accessibility_note=?, duration_minutes=?, image_media_id=?, active=? WHERE id=?`,
        ...values, id);
      audit("class_type.updated", { actorType: "admin", actor: admin.email, entityType: "class_type", entityId: id });
    } else {
      const res = run(`INSERT INTO class_types (name, slug, description, suitability, what_to_bring, accessibility_note, duration_minutes, image_media_id, active) VALUES (?,?,?,?,?,?,?,?,?)`,
        slug, ...values);
      audit("class_type.created", { actorType: "admin", actor: admin.email, entityType: "class_type", entityId: Number(res.lastInsertRowid) });
    }
  } catch {
    redirect("/admin/class-types?error=That+web+address+name+is+already+in+use+-+try+a+slightly+different+one");
  }
  revalidatePath("/admin/class-types");
  redirect("/admin/class-types?saved=1");
}

// ---------- Instructors ----------

export async function saveInstructorAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin/instructors?error=Please+give+the+instructor+a+name");
  const bio = String(formData.get("bio") ?? "") || null;
  const active = formData.get("active") === "on" ? 1 : 0;
  if (id) {
    run(`UPDATE instructors SET name=?, bio=?, active=? WHERE id=?`, name, bio, active, id);
    audit("instructor.updated", { actorType: "admin", actor: admin.email, entityType: "instructor", entityId: id });
  } else {
    const res = run(`INSERT INTO instructors (name, bio, active) VALUES (?,?,?)`, name, bio, active);
    audit("instructor.created", { actorType: "admin", actor: admin.email, entityType: "instructor", entityId: Number(res.lastInsertRowid) });
  }
  revalidatePath("/admin/instructors");
  redirect("/admin/instructors?saved=1");
}

// ---------- Series extras ----------

export async function generateMoreForSeriesAction(formData: FormData) {
  const admin = await guardWrite();
  const seriesId = Number(formData.get("id"));
  const series = get<{ weekdays: string; start_time: string; end_time: string; title: string; skip_dates: string | null; class_type_id: number | null; venue_id: number | null; instructor_id: number | null; capacity: number; price_override_cents: number | null; waitlist_enabled: number; publication_status: "draft" | "published" }>(
    `SELECT * FROM class_series WHERE id = ?`, seriesId
  );
  if (!series) redirect("/admin/classes?error=Series+not+found");
  const fromDate = String(formData.get("fromDate") ?? "");
  const toDate = String(formData.get("toDate") ?? "");
  if (!fromDate || !toDate || toDate < fromDate) {
    redirect(`/admin/classes?error=Choose+a+valid+date+range+to+fill`);
  }
  const settings = await getSettings();
  const { generateOccurrences } = await import("@/lib/tz");
  const extraSkips = String(formData.get("skipDates") ?? "")
    .split(/[\s,]+/)
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const skip = [...(series.skip_dates ? (JSON.parse(series.skip_dates) as string[]) : []), ...extraSkips];
  const slots = generateOccurrences({
    weekdays: JSON.parse(series.weekdays),
    startTime: series.start_time,
    endTime: series.end_time,
    fromDate,
    toDate,
    tz: settings.timezone,
    skipDates: skip,
  });
  let created = 0;
  for (const s of slots) {
    const exists = get(`SELECT id FROM class_occurrences WHERE series_id = ? AND starts_at = ?`, seriesId, s.startsAt);
    if (!exists) {
      run(
        `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, price_override_cents, waitlist_enabled, publication_status, source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'series')`,
        seriesId, series.class_type_id, series.venue_id, series.instructor_id,
        series.title.split("-")[0].trim() || series.title, s.startsAt, s.endsAt, series.capacity, series.price_override_cents, series.waitlist_enabled, series.publication_status
      );
      created++;
    }
  }
  audit("series.topup", { actorType: "admin", actor: admin.email, entityType: "series", entityId: seriesId, detail: { created, fromDate, toDate, skips: extraSkips } });
  revalidatePath("/admin/classes");
  redirect(`/admin/classes/new?created=${created}`);
}

export async function updateSeriesAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim() || "Weekly class";
  const capacity = Math.max(1, Number(formData.get("capacity") ?? 12));
  const priceOverride = parseEuroInputToCents(String(formData.get("priceOverrideRaw") ?? "")); // form shows euros; column is cents
  const waitlist = formData.get("waitlist") === "on" ? 1 : 0;
  const active = formData.get("active") === "on" ? 1 : 0;
  const publicationStatus = formData.get("publicationStatus") === "published" ? "published" : "draft";
  const current = get<{ publication_status: string }>(`SELECT publication_status FROM class_series WHERE id = ?`, id);
  if (!current) redirect("/admin/classes?error=Series+not+found");
  if (current.publication_status === "published" && publicationStatus === "draft") {
    const usage = get<{ bookings: number; holds: number }>(
      `SELECT
         (SELECT COUNT(*) FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id WHERE o.series_id = ?) AS bookings,
         (SELECT COUNT(*) FROM capacity_holds h JOIN class_occurrences o ON o.id = h.occurrence_id JOIN orders ord ON ord.id = h.order_id WHERE o.series_id = ? AND h.released = 0 AND h.expires_at > ? AND ord.status IN ('pending','awaiting_payment')) AS holds`,
      id, id, nowIso()
    )!;
    if (usage.bookings > 0 || usage.holds > 0) {
      redirect("/admin/classes/new?error=A+series+with+bookings+or+active+checkouts+must+stay+published.+Retire+it+to+stop+new+dates");
    }
  }
  const skipDates = String(formData.get("skipDates") ?? "")
    .split(/[\s,]+/)
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const venueId = Number(formData.get("venueId")) || null;
  const instructorId = Number(formData.get("instructorId")) || null;
  run(
    `UPDATE class_series SET title=?, capacity=?, price_override_cents=?, waitlist_enabled=?, status=?, publication_status=?, skip_dates=?, venue_id=?, instructor_id=?, updated_at=? WHERE id=?`,
    title, capacity, priceOverride, waitlist, active ? "active" : "retired", publicationStatus, JSON.stringify(skipDates), venueId, instructorId, nowIso(), id
  );
  run(`UPDATE class_occurrences SET publication_status=?, updated_at=? WHERE series_id=? AND status='scheduled'`, publicationStatus, nowIso(), id);
  audit("series.updated", { actorType: "admin", actor: admin.email, entityType: "series", entityId: id, detail: { capacity, active: !!active } });
  revalidatePath("/admin/classes");
  redirect(`/admin/classes/new?saved=1#series-manage`);
}

export async function duplicateSeriesAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const series = get<Record<string, unknown>>(`SELECT * FROM class_series WHERE id = ?`, id);
  if (!series) redirect("/admin/classes?error=Series+not+found");
  const res = run(
    `INSERT INTO class_series (title, class_type_id, venue_id, instructor_id, weekdays, start_time, end_time, capacity, booking_close_hours_before, price_override_cents, waitlist_enabled, status, skip_dates, publication_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft')`,
    `${String(series.title)} (copy)`, series.class_type_id, series.venue_id, series.instructor_id,
    series.weekdays, series.start_time, series.end_time, series.capacity, series.booking_close_hours_before,
    series.price_override_cents, series.waitlist_enabled, "retired", series.skip_dates ?? null
  );
  audit("series.duplicated", { actorType: "admin", actor: admin.email, entityType: "series", entityId: Number(res.lastInsertRowid), detail: { from: id } });
  revalidatePath("/admin/classes");
  redirect(`/admin/classes?saved=1#series-${Number(res.lastInsertRowid)}`);
}

export async function duplicateOccurrenceAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const occ = get<Record<string, unknown>>(`SELECT * FROM class_occurrences WHERE id = ?`, id);
  if (!occ) redirect("/admin/classes?error=Class+not+found");
  // copy to the same local wall-clock time one week later (DST-safe)
  const settings = await getSettings();
  const res = run(
    `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, price_override_cents, waitlist_enabled, publication_status, notes_public, notes_admin, source)
     VALUES (NULL,?,?,?,?,?,?,?,?,?, 'draft',?,?,?, 'manual')`,
    occ.class_type_id, occ.venue_id, occ.instructor_id, occ.title,
    addDaysLocal(String(occ.starts_at), 7, settings.timezone),
    addDaysLocal(String(occ.ends_at), 7, settings.timezone),
    occ.capacity, occ.price_override_cents, occ.waitlist_enabled, occ.notes_public, occ.notes_admin
  );
  audit("occurrence.duplicated", { actorType: "admin", actor: admin.email, entityType: "occurrence", entityId: Number(res.lastInsertRowid), detail: { from: id } });
  revalidatePath("/admin/classes");
  redirect(`/admin/classes/${Number(res.lastInsertRowid)}?saved=1`);
}

async function getSettings() {
  const { getSettings } = await import("@/lib/settings");
  return getSettings();
}


// ---------- Blocks & bundles ----------

export async function createBlockAction(formData: FormData) {
  const admin = await guardWrite();
  const seriesId = Number(formData.get("seriesId"));
  const name = String(formData.get("name") ?? "").trim();
  const startDate = String(formData.get("startDate") ?? "");
  const endMode = String(formData.get("endMode") ?? "date");
  const weeks = Math.max(1, Number(formData.get("weeks") ?? 8));
  let endDate = String(formData.get("endDate") ?? "");
  const price = parseEuroInputToCents(String(formData.get("price") ?? ""));
  if (!seriesId || !name || !startDate || !endDate || price === null || price <= 0) {
    redirect("/admin/classes?error=Block+needs+a+name,+dates+and+a+price");
  }
  if (endMode === "weeks") {
    const end = new Date(`${startDate}T00:00:00`);
    end.setDate(end.getDate() + weeks * 7 - 1);
    endDate = end.toISOString().slice(0, 10);
  }
  if (endDate < startDate) redirect("/admin/classes?error=The+block+cannot+end+before+it+starts");
  const weekdays = formData.getAll("blockWeekdays").map(Number).filter((n) => n >= 1 && n <= 7);
  const series = get<{ weekdays: string; publication_status: string }>(`SELECT weekdays, publication_status FROM class_series WHERE id = ?`, seriesId);
  if (!series) redirect("/admin/classes?error=Series+not+found");
  const publicationStatus = formData.get("publicationStatus") === "published" ? "published" : "draft";
  const seriesDays = JSON.parse(series.weekdays) as number[];
  const blockDays = weekdays.length > 0 ? weekdays.filter((d) => seriesDays.includes(d)) : seriesDays;
  if (blockDays.length === 0) {
    redirect("/admin/classes?error=Pick+at+least+one+day+that+the+series+runs+on");
  }
  const res = run(
    `INSERT INTO class_blocks (series_id, name, start_date, end_date, price_cents, weekdays, active, publication_status) VALUES (?,?,?,?,?,?,1,?)`,
    seriesId, name, startDate, endDate, price, JSON.stringify(blockDays), publicationStatus
  );
  if (publicationStatus === "published") {
    run(`UPDATE class_series SET publication_status='published', updated_at=? WHERE id=?`, nowIso(), seriesId);
    run(`UPDATE class_occurrences SET publication_status='published', updated_at=? WHERE series_id=? AND status='scheduled'`, nowIso(), seriesId);
  }
  audit("block.created", { actorType: "admin", actor: admin.email, entityType: "class_block", entityId: Number(res.lastInsertRowid), detail: { name, startDate, endDate, price } });
  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  redirect("/admin/classes/new?saved=1#block");
}

export async function updateBlockAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const price = parseEuroInputToCents(String(formData.get("price") ?? ""));
  const offeringStatus = String(formData.get("offeringStatus") ?? "");
  if (offeringStatus && !["draft", "on_sale", "not_for_sale"].includes(offeringStatus)) {
    redirect("/admin/classes?error=Choose+a+valid+booking+status");
  }
  const active = offeringStatus
    ? offeringStatus === "not_for_sale" ? 0 : 1
    : formData.get("active") === "on" ? 1 : 0;
  const publicationStatus = offeringStatus
    ? offeringStatus === "draft" ? "draft" : "published"
    : formData.get("publicationStatus") === "published" ? "published" : "draft";
  if (!name || !startDate || !endDate || price === null || price <= 0 || endDate < startDate) {
    redirect("/admin/classes?error=Block+needs+a+name,+valid+dates+and+a+price");
  }
  const weekdays = formData.getAll("blockWeekdays").map(Number).filter((n) => n >= 1 && n <= 7);
  const weekdaysJson = weekdays.length > 0 ? JSON.stringify(weekdays) : null;
  const block = get<{ series_id: number; kind: string; publication_status: string; start_date: string; end_date: string; weekdays: string | null }>(
    `SELECT series_id, kind, publication_status, start_date, end_date, weekdays FROM class_blocks WHERE id = ?`, id
  );
  if (!block) redirect("/admin/classes?error=Block+not+found");
  const isEvent = block.kind === "workshop" || block.kind === "retreat";
  let eventFields: { summary: string | null; description: string | null; imageMediaId: number | null; earlyBirdPrice: number | null; earlyBirdUntil: string | null; dailyTimes: string | null } | null = null;
  if (isEvent && formData.get("eventFields") === "1") {
    const earlyRaw = String(formData.get("earlyBirdPrice") ?? "").trim();
    const earlyBirdPrice = earlyRaw ? parseEuroInputToCents(earlyRaw) : null;
    const earlyBirdUntil = String(formData.get("earlyBirdUntil") ?? "").trim() || null;
    if (earlyRaw && (earlyBirdPrice === null || earlyBirdPrice <= 0 || earlyBirdPrice >= price)) {
      redirect("/admin/classes?error=The+early-bird+price+must+be+lower+than+the+event+price");
    }
    if (earlyBirdPrice !== null && !earlyBirdUntil) redirect("/admin/classes?error=Add+an+early-bird+deadline+or+clear+the+early-bird+price");
    let dailyTimes: string | null = null;
    const start = String(formData.get("eventStartTime") ?? "");
    const end = String(formData.get("eventEndTime") ?? "");
    if (formData.has("eventStartTime")) {
      const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
      if (!validTime(start) || !validTime(end) || start >= end) {
        redirect("/admin/classes?error=Enter+valid+start+and+end+times.+Times+use+the+24-hour+clock+and+the+end+must+be+after+the+start+(for+example+13:00+to+16:00)");
      }
      dailyTimes = JSON.stringify({ mode: "same", start, end });
    }
    eventFields = {
      summary: String(formData.get("summary") ?? "").trim().slice(0, 300) || null,
      description: String(formData.get("description") ?? "").trim() || null,
      imageMediaId: Number(formData.get("imageMediaId")) || null,
      earlyBirdPrice: earlyRaw ? earlyBirdPrice : null,
      earlyBirdUntil: earlyRaw ? earlyBirdUntil : null,
      dailyTimes,
    };
  }
  const dropInsEnabled = block.kind === "block" && formData.get("dropInsEnabled") === "on";
  const series = get<{
    publication_status: string; weekdays: string; start_time: string; end_time: string;
    skip_dates: string | null; class_type_id: number | null; venue_id: number | null;
    instructor_id: number | null; capacity: number; waitlist_enabled: number;
  }>(`SELECT publication_status, weekdays, start_time, end_time, skip_dates, class_type_id, venue_id, instructor_id, capacity, waitlist_enabled FROM class_series WHERE id = ?`, block.series_id);
  if (!series) redirect("/admin/classes?error=Schedule+not+found");
  const schedulePublicationStatus = block.kind === "block"
    ? dropInsEnabled ? "published" : "draft"
    : publicationStatus;
  const startTime = String(formData.get("startTime") ?? series.start_time);
  const endTime = String(formData.get("endTime") ?? series.end_time);
  if (block.kind === "block" && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime)) {
    redirect("/admin/classes?error=Enter+a+valid+class+start+and+end+time");
  }
  const scheduleChanged = block.kind === "block" &&
    (startTime !== series.start_time || endTime !== series.end_time || startDate !== block.start_date || endDate !== block.end_date);
  let updatedSlots: ReturnType<typeof generateOccurrences> = [];
  let settings: Awaited<ReturnType<typeof getSettings>> | null = null;
  if (scheduleChanged) {
    settings = await getSettings();
    const blockDays = block.weekdays ? JSON.parse(block.weekdays) as number[] : JSON.parse(series.weekdays) as number[];
    updatedSlots = generateOccurrences({
      weekdays: blockDays,
      startTime,
      endTime,
      fromDate: startDate,
      toDate: endDate,
      tz: settings.timezone,
      skipDates: series.skip_dates ? JSON.parse(series.skip_dates) as string[] : [],
    });
    if (updatedSlots.length === 0) redirect("/admin/classes?error=No+classes+fall+between+those+dates");
  }
  tx(() => {
    if (scheduleChanged) {
      const usage = get<{ bookings: number; holds: number; waitlist: number }>(
        `SELECT
           (SELECT COUNT(*) FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id
            WHERE o.series_id = ? AND b.status IN ('confirmed','attended')) AS bookings,
           (SELECT COUNT(*) FROM capacity_holds h JOIN orders ord ON ord.id = h.order_id
            JOIN class_occurrences o ON o.id = h.occurrence_id
            WHERE o.series_id = ? AND h.released = 0 AND h.expires_at > ?
              AND ord.status IN ('pending','awaiting_payment')) AS holds,
           (SELECT COUNT(*) FROM waitlist_entries w JOIN class_occurrences o ON o.id = w.occurrence_id
            WHERE o.series_id = ? AND w.status IN ('waiting','offered')) AS waitlist`,
        block.series_id, block.series_id, nowIso(), block.series_id
      )!;
      if (usage.bookings > 0 || usage.holds > 0 || usage.waitlist > 0) {
        redirect("/admin/classes?error=Dates+or+times+cannot+change+while+students+are+booked,+checking+out,+or+on+the+waitlist");
      }
    }
    if (series?.publication_status !== schedulePublicationStatus) {
      const current = nowIso();
      const existingDropInBookings = get<{ bookings: number; holds: number; waitlist: number }>(
        `SELECT
           (SELECT COUNT(*) FROM bookings b JOIN order_items oi ON oi.id = b.order_item_id
            JOIN class_occurrences o ON o.id = b.occurrence_id
            WHERE o.series_id = ? AND COALESCE(oi.kind, 'class') = 'class' AND o.starts_at > ?) AS bookings,
           (SELECT COUNT(*) FROM capacity_holds h JOIN orders ord ON ord.id = h.order_id
            JOIN order_items oi ON oi.order_id = ord.id JOIN class_occurrences o ON o.id = h.occurrence_id
            WHERE o.series_id = ? AND COALESCE(oi.kind, 'class') = 'class' AND h.released = 0 AND h.expires_at > ?
              AND ord.status IN ('pending','awaiting_payment') AND o.starts_at > ?) AS holds,
           (SELECT COUNT(*) FROM waitlist_entries w JOIN class_occurrences o ON o.id = w.occurrence_id
            WHERE o.series_id = ? AND w.status IN ('waiting','offered') AND o.starts_at > ?) AS waitlist`,
        block.series_id, current, block.series_id, current, current, block.series_id, current
      )!;
      if (existingDropInBookings.bookings > 0 || existingDropInBookings.holds > 0 || existingDropInBookings.waitlist > 0) {
        redirect("/admin/classes?error=Individual+class+bookings+or+waitlist+members+already+exist.+Keep+drop-in+booking+enabled+or+resolve+those+first");
      }
    }
    if (block.publication_status === "published" && publicationStatus === "draft") {
      const usage = get<{ bookings: number; holds: number }>(
        `SELECT
           (SELECT COUNT(*) FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id WHERE o.series_id = ? AND b.status IN ('confirmed','attended')) AS bookings,
           (SELECT COUNT(*) FROM capacity_holds h JOIN class_occurrences o ON o.id = h.occurrence_id JOIN orders ord ON ord.id = h.order_id WHERE o.series_id = ? AND h.released = 0 AND h.expires_at > ? AND ord.status IN ('pending','awaiting_payment')) AS holds`,
        block.series_id, block.series_id, nowIso()
      )!;
      if (usage.bookings > 0 || usage.holds > 0) redirect("/admin/classes?error=A+block+with+bookings+or+active+checkouts+must+stay+published");
    }
    run(`UPDATE class_blocks SET name=?, start_date=?, end_date=?, price_cents=?, weekdays=COALESCE(?, weekdays), active=?, publication_status=?, updated_at=? WHERE id=?`,
      name, startDate, endDate, price, weekdaysJson, active, publicationStatus, nowIso(), id);
    if (eventFields) {
      run(`UPDATE class_blocks SET summary=?, description=?, image_media_id=?, early_bird_price_cents=?, early_bird_until=?, daily_times_json=COALESCE(?, daily_times_json) WHERE id=?`,
        eventFields.summary, eventFields.description, eventFields.imageMediaId, eventFields.earlyBirdPrice, eventFields.earlyBirdUntil, eventFields.dailyTimes, id);
    }
    run(`UPDATE class_series SET title=?, start_time=?, end_time=?, publication_status=?, updated_at=? WHERE id=?`,
      name, startTime, endTime, schedulePublicationStatus, nowIso(), block.series_id);
    if (scheduleChanged && settings) {
      const existing = all<{ id: number; starts_at: string }>(
        `SELECT id, starts_at FROM class_occurrences WHERE series_id = ? AND status = 'scheduled'`,
        block.series_id
      );
      const dateKey = (instant: string) => {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(new Date(instant));
        return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
      };
      const byDate = new Map(existing.map((occurrence) => [dateKey(occurrence.starts_at), occurrence.id]));
      for (const slot of updatedSlots) {
        const occurrenceId = byDate.get(slot.dateKey);
        if (occurrenceId) {
          run(`UPDATE class_occurrences SET title=?, starts_at=?, ends_at=?, publication_status=?, updated_at=? WHERE id=?`,
            name, slot.startsAt, slot.endsAt, schedulePublicationStatus, nowIso(), occurrenceId);
        } else {
          run(
            `INSERT OR IGNORE INTO class_occurrences (series_id, class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, waitlist_enabled, publication_status, source)
             VALUES (?,?,?,?,?,?,?,?,?,?, 'series')`,
            block.series_id, series.class_type_id, series.venue_id, series.instructor_id, name,
            slot.startsAt, slot.endsAt, series.capacity, series.waitlist_enabled, schedulePublicationStatus
          );
        }
      }
    } else {
      run(`UPDATE class_occurrences SET title=?, publication_status=?, updated_at=? WHERE series_id=? AND status='scheduled' AND starts_at >= ?`,
        name, schedulePublicationStatus, nowIso(), block.series_id, nowIso());
    }
    audit("block.updated", { actorType: "admin", actor: admin.email, entityType: "class_block", entityId: id, detail: { name, startDate, endDate, price, active } });
  });
  revalidatePath("/admin/classes");
  revalidatePath("/admin/bookings");
  revalidatePath("/classes");
  revalidatePath("/workshops");
  redirect("/admin/classes?saved=1#blocks");
}

export async function createBundleAction(formData: FormData) {
  const admin = await guardWrite();
  const name = String(formData.get("name") ?? "").trim();
  const price = parseEuroInputToCents(String(formData.get("price") ?? ""));
  const blockIds = formData.getAll("blockIds").map(Number).filter(Boolean);
  const publicationStatus = formData.get("publicationStatus") === "published" ? "published" : "draft";
  if (!name || price === null || price <= 0 || blockIds.length < 2) {
    redirect("/admin/classes?error=Bundles+need+a+name,+a+price+and+at+least+two+blocks");
  }
  if (publicationStatus === "published") {
    const placeholders = blockIds.map(() => "?").join(",");
    const unpublished = get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM class_blocks cb JOIN class_series cs ON cs.id = cb.series_id
       WHERE cb.id IN (${placeholders}) AND cb.publication_status != 'published'`,
      ...blockIds
    )!;
    if (unpublished.count > 0) redirect("/admin/classes?error=Publish+every+included+block+before+publishing+this+bundle");
  }
  const res = run(`INSERT INTO block_bundles (name, price_cents, active, publication_status) VALUES (?,?,1,?)`, name, price, publicationStatus);
  const bundleId = Number(res.lastInsertRowid);
  blockIds.forEach((bid, i) => {
    run(`INSERT INTO block_bundle_items (bundle_id, block_id, sort) VALUES (?,?,?)`, bundleId, bid, i);
  });
  audit("bundle.created", { actorType: "admin", actor: admin.email, entityType: "block_bundle", entityId: bundleId, detail: { name, price, blockIds } });
  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  redirect("/admin/classes/new?saved=1#bundle");
}

export async function toggleBundleAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  run(`UPDATE block_bundles SET active = 1 - active, updated_at = ? WHERE id = ?`, nowIso(), id);
  audit("bundle.toggled", { actorType: "admin", actor: admin.email, entityType: "block_bundle", entityId: id });
  revalidatePath("/admin/classes");
  revalidatePath("/classes");
}

export async function setBundlePublicationAction(formData: FormData) {
  const admin = await guardWrite();
  const id = Number(formData.get("id"));
  const publicationStatus = formData.get("publicationStatus") === "published" ? "published" : "draft";
  const bundle = get<{ publication_status: string }>(`SELECT publication_status FROM block_bundles WHERE id = ?`, id);
  if (!bundle) redirect("/admin/classes?error=Bundle+not+found");
  if (bundle.publication_status === "published" && publicationStatus === "draft") {
    const use = get<{ bookings: number; holds: number }>(
      `SELECT
         (SELECT COUNT(*) FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id
          WHERE o.series_id IN (SELECT cb.series_id FROM block_bundle_items bi JOIN class_blocks cb ON cb.id = bi.block_id WHERE bi.bundle_id = ?)) AS bookings,
         (SELECT COUNT(*) FROM capacity_holds h JOIN orders ord ON ord.id = h.order_id JOIN class_occurrences o ON o.id = h.occurrence_id
          WHERE o.series_id IN (SELECT cb.series_id FROM block_bundle_items bi JOIN class_blocks cb ON cb.id = bi.block_id WHERE bi.bundle_id = ?)
          AND h.released = 0 AND h.expires_at > ? AND ord.status IN ('pending','awaiting_payment')) AS holds`,
      id, id, nowIso()
    )!;
    if (use.bookings > 0 || use.holds > 0) redirect("/admin/classes?error=A+bundle+with+bookings+or+active+checkouts+must+stay+published");
  }
  if (publicationStatus === "published") {
    const unpublished = get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM block_bundle_items bi JOIN class_blocks cb ON cb.id = bi.block_id
       JOIN class_series cs ON cs.id = cb.series_id WHERE bi.bundle_id = ?
       AND cb.publication_status != 'published'`, id
    )!;
    if (unpublished.count > 0) redirect("/admin/classes?error=Publish+every+included+block+before+publishing+this+bundle");
  }
  run(`UPDATE block_bundles SET publication_status=?, updated_at=? WHERE id=?`, publicationStatus, nowIso(), id);
  audit("bundle.publication_updated", { actorType: "admin", actor: admin.email, entityType: "block_bundle", entityId: id, detail: { publicationStatus } });
  revalidatePath("/admin/classes");
  revalidatePath("/classes");
}
