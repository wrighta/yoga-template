import { all, get, nowIso } from "@/db";
import { getSettings } from "./settings";
import { generateOccurrences, fmtDate, zonedToUtc } from "./tz";
import { activeHoldCount, confirmedCount } from "./schedule";

/**
 * Class blocks: a named date range over one recurring series, sold for ONE
 * price that books the student into every date in the block. Bundles group
 * 2+ existing blocks under a single bulk price - no new classes, just the
 * union of their dates at a better price.
 */

export type ClassBlock = {
  id: number;
  series_id: number;
  name: string;
  start_date: string;
  end_date: string;
  price_cents: number;
  weekdays: string | null; // JSON array; null = every series day
  kind: string; // 'block' | 'workshop'
  description: string | null;
  image_media_id: number | null;
  early_bird_price_cents: number | null;
  early_bird_until: string | null;
  daily_times_json: string | null;
  active: number;
  publication_status: "draft" | "published";
};

/** The price a student pays today for this block/workshop (early bird if still open). */
export function effectivePriceCents(block: {
  price_cents: number;
  early_bird_price_cents: number | null;
  early_bird_until: string | null;
}, now = new Date().toISOString()): number {
  if (
    block.early_bird_price_cents != null &&
    block.early_bird_price_cents > 0 &&
    block.early_bird_until &&
    block.early_bird_until >= now.slice(0, 10)
  ) {
    return block.early_bird_price_cents;
  }
  return block.price_cents;
}

export type BlockDate = {
  occurrenceId: number;
  startsAt: string;
  endsAt: string;
  dateKey: string;
  displayDate: string;
  status: "scheduled" | "cancelled";
  booked: number;
  capacity: number;
  full: boolean;
};

export type BlockView = ClassBlock & {
  seriesTitle: string;
  meetingDays: number[];
  startTime: string;
  endTime: string;
  effectivePrice: number;
  isEarlyBird: boolean;
  imageUrl: string | null;
  classTypeName: string;
  venueName: string | null;
  dates: BlockDate[];
  classCount: number;
  bookableCount: number; // future, scheduled, not cancelled
  fullDates: number;
  waitlistDates: number;
  remainingSeatsMin: number;
  perClassCents: number;
  isPast: boolean;
  onSale: boolean; // at least one date bookable and block not started… (start date in the future OR dates remain)
  seriesPublicationStatus: "draft" | "published";
  stateLabel: string;
};

function fmtLocalDate(dateKey: string, tz: string): string {
  return fmtDate(`${dateKey}T12:00:00.000Z`, tz);
}

/** All dates of a block, computed from its series (skip dates honoured). */
export function blockDates(block: ClassBlock): { occurrenceId: number; startsAt: string; endsAt: string; dateKey: string; status: "scheduled" | "cancelled" }[] {
  const series = get<{ weekdays: string; start_time: string; end_time: string; skip_dates: string | null; class_type_id: number | null; venue_id: number | null; instructor_id: number | null; capacity: number }>(
    `SELECT * FROM class_series WHERE id = ?`,
    block.series_id
  );
  if (!series) return [];
  if (block.kind === "workshop" || block.kind === "retreat") {
    const occurrence = get<{ id: number; starts_at: string; ends_at: string; status: "scheduled" | "cancelled" }>(
      `SELECT id, starts_at, ends_at, status FROM class_occurrences WHERE series_id = ? ORDER BY starts_at LIMIT 1`,
      block.series_id
    );
    return occurrence
      ? [{ occurrenceId: occurrence.id, startsAt: occurrence.starts_at, endsAt: occurrence.ends_at, dateKey: block.start_date, status: occurrence.status }]
      : [];
  }
  const settings = getSettingsSync();
  const blockWeekdays = block.weekdays ? (JSON.parse(block.weekdays) as number[]) : JSON.parse(series.weekdays);
  const slots = generateOccurrences({
    weekdays: blockWeekdays,
    startTime: series.start_time,
    endTime: series.end_time,
    fromDate: block.start_date,
    toDate: block.end_date,
    tz: settings.timezone,
    skipDates: series.skip_dates ? (JSON.parse(series.skip_dates) as string[]) : [],
  });
  const out: { occurrenceId: number; startsAt: string; endsAt: string; dateKey: string; status: "scheduled" | "cancelled" }[] = [];
  for (const s of slots) {
    const occ = get<{ id: number; status: "scheduled" | "cancelled" }>(
      `SELECT id, status FROM class_occurrences WHERE series_id = ? AND starts_at = ?`,
      block.series_id, s.startsAt
    );
    if (occ) {
      out.push({ occurrenceId: occ.id, startsAt: s.startsAt, endsAt: s.endsAt, dateKey: s.dateKey, status: occ.status });
    }
  }
  return out;
}

function getSettingsSync() {
  const rows = all<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const map: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      map[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore */
    }
  }
  return { timezone: (map.timezone as string) ?? "Europe/Dublin" };
}

export function getBlock(id: number): ClassBlock | undefined {
  return get<ClassBlock>(`SELECT id, series_id, name, start_date, end_date, price_cents, weekdays, kind, description, image_media_id, early_bird_price_cents, early_bird_until, daily_times_json, active, publication_status FROM class_blocks WHERE id = ?`, id);
}

/** Public/admin view of a block with live availability. */
export async function getBlockView(id: number): Promise<BlockView | null> {
  const block = getBlock(id);
  if (!block) return null;
  return blockView(block);
}

export async function blockView(block: ClassBlock): Promise<BlockView> {
  const settings = await getSettings();
  const series = get<{ title: string; class_type_id: number | null; venue_id: number | null; capacity: number; publication_status: "draft" | "published"; weekdays: string; start_time: string; end_time: string }>(`SELECT title, class_type_id, venue_id, capacity, publication_status, weekdays, start_time, end_time FROM class_series WHERE id = ?`, block.series_id);
  const meetingDays = block.weekdays ? JSON.parse(block.weekdays) as number[] : series ? JSON.parse(series.weekdays) as number[] : [];
  const classTypeName = series?.class_type_id
    ? get<{ name: string }>(`SELECT name FROM class_types WHERE id = ?`, series.class_type_id)?.name ?? ""
    : "";
  const venueName = series?.venue_id
    ? get<{ name: string }>(`SELECT name FROM venues WHERE id = ?`, series.venue_id)?.name ?? null
    : null;
  const now = nowIso();
  const eventEnd = block.kind === "workshop" || block.kind === "retreat"
    ? zonedToUtc(
        Number(block.end_date.slice(0, 4)), Number(block.end_date.slice(5, 7)), Number(block.end_date.slice(8, 10)),
        23, 59, settings.timezone
      )
    : null;
  const dates: BlockDate[] = blockDates(block).map((d) => {
    const capacity = series?.capacity ?? 12;
    const booked = confirmedCount(d.occurrenceId);
    const remaining = Math.max(0, capacity - booked - activeHoldCount(d.occurrenceId));
    return {
      ...d,
      displayDate: fmtLocalDate(d.dateKey, settings.timezone),
      booked,
      capacity,
      full: remaining < 1 || d.status === "cancelled",
    };
  });
  const classCount = dates.length;
  const future = dates.filter((d) => (eventEnd ? eventEnd > now : d.startsAt > now) && d.status === "scheduled");
  const fullDates = dates.filter((d) => d.full).length;
  const waitlistDates = dates.filter((d) => d.full && d.status === "scheduled").length;
  const remainingSeatsMin = dates.length ? Math.min(...dates.map((d) => Math.max(0, d.capacity - d.booked - activeHoldCount(d.occurrenceId)))) : 0;
  const isPast = future.length === 0;
  const isEvent = block.kind === "workshop" || block.kind === "retreat";

  let stateLabel: string;
  if (classCount === 0) stateLabel = "No dates yet";
  else if (isPast) stateLabel = "Finished";
  else if (isEvent && remainingSeatsMin === 0) stateLabel = "Sold out";
  else if (isEvent) stateLabel = `${remainingSeatsMin} places available`;
  else if (future.length === 0) stateLabel = "Fully booked";
  else stateLabel = `${future.length} classes to come`;

  const effPrice = effectivePriceCents(block, now);
  const isEarlyBird = effPrice !== block.price_cents;
  const { mediaUrl } = await import("./media");

  return {
    ...block,
    seriesTitle: series?.title ?? "",
    meetingDays,
    startTime: series?.start_time ?? "",
    endTime: series?.end_time ?? "",
    effectivePrice: effPrice,
    isEarlyBird,
    imageUrl: block.image_media_id ? mediaUrl(block.image_media_id) : null,
    classTypeName,
    venueName,
    dates,
    classCount,
    bookableCount: future.length,
    fullDates,
    waitlistDates,
    remainingSeatsMin,
    perClassCents: classCount ? Math.round(effPrice / classCount) : effPrice,
    isPast,
    onSale: !isPast && future.length > 0 && (!isEvent || remainingSeatsMin > 0),
    seriesPublicationStatus: series?.publication_status ?? "draft",
    stateLabel,
  };
}

export async function listActiveBlockViews(): Promise<BlockView[]> {
  const blocks = all<ClassBlock>(`SELECT id, series_id, name, start_date, end_date, price_cents, weekdays, kind, description, image_media_id, early_bird_price_cents, early_bird_until, daily_times_json, active, publication_status FROM class_blocks WHERE active = 1 AND publication_status = 'published' AND kind = 'block' ORDER BY start_date ASC`);
  const views = await Promise.all(blocks.map(blockView));
  return views.filter((v) => v.onSale && v.seriesPublicationStatus === "published");
}

// ---------------- Bundles ----------------

export type BundleView = {
  id: number;
  name: string;
  price_cents: number;
  active: number;
  publication_status: "draft" | "published";
  blocks: BlockView[];
  classCount: number;
  onSale: boolean;
  published: boolean;
};

export async function getBundleView(id: number): Promise<BundleView | null> {
  const bundle = get<{ id: number; name: string; price_cents: number; active: number; publication_status: "draft" | "published" }>(
    `SELECT id, name, price_cents, active, publication_status FROM block_bundles WHERE id = ?`,
    id
  );
  if (!bundle) return null;
  const blocks = all<{ block_id: number }>(`SELECT block_id FROM block_bundle_items WHERE bundle_id = ? ORDER BY sort ASC`, id);
  const views = (await Promise.all(blocks.map((b) => getBlockView(b.block_id)))).filter((v): v is BlockView => !!v);
  return {
    ...bundle,
    blocks: views,
    classCount: views.reduce((s, v) => s + v.classCount, 0),
    onSale: views.length >= 2 && views.every((v) => v.onSale || v.classCount === 0 ? v.onSale : v.onSale),
    published: bundle.publication_status === "published" && views.every((v) => v.publication_status === "published" && v.seriesPublicationStatus === "published"),
  };
}

export async function listWorkshopViews(): Promise<BlockView[]> {
  const blocks = all<ClassBlock>(
    `SELECT cb.id, cb.series_id, cb.name, cb.start_date, cb.end_date, cb.price_cents, cb.weekdays, cb.kind, cb.description, cb.image_media_id, cb.early_bird_price_cents, cb.early_bird_until, cb.daily_times_json, cb.active, cb.publication_status
     FROM class_blocks cb JOIN class_series cs ON cs.id = cb.series_id
    WHERE cb.active = 1 AND cb.publication_status = 'published' AND cs.publication_status = 'published' AND cb.kind IN ('workshop','retreat') ORDER BY cb.start_date ASC`
  );
  const views = await Promise.all(blocks.map(blockView));
  return views.filter((v) => !v.isPast);
}

export async function listActiveBundleViews(): Promise<BundleView[]> {
  const bundles = all<{ id: number }>(`SELECT id FROM block_bundles WHERE active = 1 AND publication_status = 'published' ORDER BY id ASC`);
  const out: BundleView[] = [];
  for (const b of bundles) {
    const view = await getBundleView(b.id);
    if (view && view.onSale && view.published) out.push(view);
  }
  return out;
}

/** Union of every date across the bundle's blocks, one seat per date. */
export function bundleOccurrences(bundleId: number): { blockId: number; blockName: string; occurrenceIds: number[] }[] {
  const items = all<{ block_id: number }>(`SELECT block_id FROM block_bundle_items WHERE bundle_id = ? ORDER BY sort ASC`, bundleId);
  const out: { blockId: number; blockName: string; occurrenceIds: number[] }[] = [];
  for (const item of items) {
    const block = getBlock(item.block_id);
    if (!block || !block.active) continue;
    const dates = blockDates(block).filter((d) => d.status === "scheduled");
    if (dates.length > 0) {
      out.push({ blockId: block.id, blockName: block.name, occurrenceIds: dates.map((d) => d.occurrenceId) });
    }
  }
  return out;
}
