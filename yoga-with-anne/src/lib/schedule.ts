import { all, get, nowIso } from "@/db";
import { getSettings, getDropInPriceCents } from "./settings";
import { fmtDateTime } from "./tz";

export type OccurrenceRow = {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: string;
  publication_status: "draft" | "published";
  waitlist_enabled: number;
  price_override_cents: number | null;
  booking_close_at: string | null;
  booking_open_at: string | null;
  notes_public: string | null;
  class_type_id: number;
  venue_id: number | null;
  instructor_id: number | null;
  series_id: number | null;
};

export type OccurrenceView = OccurrenceRow & {
  class_type_name: string;
  suitability: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_map_url: string | null;
  instructor_name: string | null;
  booked: number;
  held: number;
  remaining: number;
  effective_price_cents: number;
  multiDateEligible: boolean;
  state: "available" | "few_spaces" | "full_waitlist" | "full" | "cancelled" | "closed" | "not_open";
  state_label: string;
  bookable: boolean;
  display: string;
};

export function activeHoldCount(occurrenceId: number): number {
  const now = nowIso();
  const r = get<{ c: number }>(
    `SELECT COALESCE(SUM(h.qty),0) AS c
     FROM capacity_holds h
     LEFT JOIN orders o ON o.id = h.order_id
     WHERE h.occurrence_id = ? AND h.released = 0 AND h.expires_at > ?
       AND (h.order_id IS NULL OR o.status IN ('pending','awaiting_payment'))`,
    occurrenceId,
    now
  )!;
  return r.c;
}

export function confirmedCount(occurrenceId: number): number {
  const r = get<{ c: number }>(
    `SELECT COALESCE(SUM(seat_count), 0) AS c FROM bookings WHERE occurrence_id = ? AND status IN ('confirmed','attended')`,
    occurrenceId
  )!;
  return r.c;
}

export async function isMultiDateDiscountActive(): Promise<boolean> {
  const row = get<{ active: number }>(`SELECT active FROM discount_rules WHERE kind = 'multi_date' LIMIT 1`);
  return !!row && row.active === 1;
}

export async function toView(row: OccurrenceRow): Promise<OccurrenceView> {
  const settings = await getSettings();
  const dropIn = await getDropInPriceCents();
  const booked = confirmedCount(row.id);
  const held = activeHoldCount(row.id);
  const remaining = Math.max(0, row.capacity - booked - held);
  const now = nowIso();
  const effective = row.price_override_cents ?? dropIn;

  let state: OccurrenceView["state"] = "available";
  let state_label = "Spaces available";
  if (row.status === "cancelled") {
    state = "cancelled";
    state_label = "Cancelled";
  } else if (row.booking_open_at && now < row.booking_open_at) {
    state = "not_open";
    state_label = "Booking opens later";
  } else if (row.booking_close_at && now > row.booking_close_at) {
    state = "closed";
    state_label = "Booking closed";
  } else if (remaining <= 0) {
    state = row.waitlist_enabled ? "full_waitlist" : "full";
    state_label = row.waitlist_enabled ? "Full - waitlist open" : "Fully booked";
  } else if (remaining <= 3) {
    state = "few_spaces";
    state_label = remaining === 1 ? "1 space left" : `${remaining} spaces left`;
  }

  const ct = row.class_type_id
    ? get<{ name: string; suitability: string | null }>(`SELECT name, suitability FROM class_types WHERE id = ?`, row.class_type_id)
    : null;
  const venue = row.venue_id
    ? get<{ name: string; address: string | null; map_url: string | null }>(`SELECT name, address, map_url FROM venues WHERE id = ?`, row.venue_id)
    : null;
  const instructor = row.instructor_id
    ? get<{ name: string }>(`SELECT name FROM instructors WHERE id = ?`, row.instructor_id)
    : null;

  return {
    ...row,
    booked,
    held,
    remaining,
    effective_price_cents: effective,
    multiDateEligible: effective === (await getDropInPriceCents()) && (await isMultiDateDiscountActive()),
    state,
    state_label,
    bookable:
      state === "available" || state === "few_spaces",
    class_type_name: ct?.name ?? "",
    suitability: ct?.suitability ?? null,
    venue_name: venue?.name ?? null,
    venue_address: venue?.address ?? null,
    venue_map_url: venue?.map_url ?? null,
    instructor_name: instructor?.name ?? null,
    display: fmtDateTime(row.starts_at, row.ends_at, settings.timezone),
  };
}

export async function listUpcoming(limit = 24, opts: { onlyBookable?: boolean } = {}): Promise<OccurrenceView[]> {
  const rows = all<OccurrenceRow>(
    `SELECT o.* FROM class_occurrences o
     LEFT JOIN class_series s ON s.id = o.series_id
     WHERE o.starts_at >= ? AND o.status = 'scheduled'
       AND o.publication_status = 'published'
       AND (o.series_id IS NULL OR (s.publication_status = 'published' AND s.status = 'active'))
     ORDER BY o.starts_at ASC LIMIT ?`,
    nowIso(),
    limit
  );
  const views = await Promise.all(rows.map(toView));
  return opts.onlyBookable ? views.filter((v) => v.bookable || v.state === "full_waitlist") : views;
}

export async function getOccurrenceView(id: number): Promise<OccurrenceView | null> {
  const row = get<OccurrenceRow>(`SELECT * FROM class_occurrences WHERE id = ?`, id);
  if (!row) return null;
  if (row.publication_status !== "published") return null;
  if (row.series_id) {
    const series = get<{ publication_status: string }>(`SELECT publication_status FROM class_series WHERE id = ?`, row.series_id);
    if (series?.publication_status !== "published") return null;
  }
  const view = await toView(row);
  const ct = get<{ name: string; suitability: string | null; description: string | null; what_to_bring: string | null; accessibility_note: string | null }>(
    `SELECT name, suitability, description, what_to_bring, accessibility_note FROM class_types WHERE id = ?`,
    row.class_type_id
  );
  const venue = row.venue_id
    ? get<{ name: string; address: string | null; map_url: string | null; parking_notes: string | null; access_notes: string | null }>(
        `SELECT name, address, map_url, parking_notes, access_notes FROM venues WHERE id = ?`,
        row.venue_id
      )
    : null;
  const instructor = row.instructor_id
    ? get<{ name: string }>(`SELECT name FROM instructors WHERE id = ?`, row.instructor_id)
    : null;
  return {
    ...view,
    class_type_name: ct?.name ?? "",
    suitability: ct?.suitability ?? null,
    venue_name: venue?.name ?? null,
    venue_address: venue?.address ?? null,
    venue_map_url: venue?.map_url ?? null,
    instructor_name: instructor?.name ?? null,
  };
}
