import { all, get, run, nowIso } from "@/db";

export type SiteSettings = {
  business_name: string;
  tagline: string;
  timezone: string;
  currency: string;
  contact_email: string;
  contact_phone_display: string;
  phone_intl: string;
  primary_venue_id: number | null;
  drop_in_cents: number;
  hold_minutes: number;
  reminder_hours: number;
  cancellation_cutoff_hours: number;
  waitlist_offer_hours: number;
  checkout_enabled: boolean;
  maintenance_mode: boolean;
  tax_note: string;
  announcement: string;
  no_classes_notice: string;
  facebook_url: string;
  instagram_url: string;
  whatsapp_greeting: string;
  logo_media_id: number | null;
  hero_media_id: number | null;
  portrait_media_id: number | null;
  og_media_id: number | null;
  class_passes_enabled: boolean;
  multi_date_discount_enabled: boolean;
  memberships_enabled: boolean;
  palette_id: string;
  accent_color: string | null;
};

export const DEFAULT_SETTINGS: SiteSettings = {
  business_name: "Yoga with Anne",
  tagline: "Gentle yoga & meditation in Lucan",
  timezone: "Europe/Dublin",
  currency: "EUR",
  contact_email: "hello@yogawithanne.ie",
  contact_phone_display: "087 763 9701",
  phone_intl: "+353877639701",
  primary_venue_id: null,
  drop_in_cents: 1200,
  hold_minutes: 10,
  reminder_hours: 24,
  cancellation_cutoff_hours: 24,
  waitlist_offer_hours: 2,
  checkout_enabled: true,
  maintenance_mode: false,
  tax_note: "",
  announcement: "",
  no_classes_notice: "",
  facebook_url: "",
  instagram_url: "",
  whatsapp_greeting: "Hi Anne! I'd like to ask about yoga classes.",
  logo_media_id: null,
  hero_media_id: null,
  portrait_media_id: null,
  og_media_id: null,
  class_passes_enabled: false,
  multi_date_discount_enabled: false,
  memberships_enabled: false, // opt-in feature for teachers who sell recurring memberships
  palette_id: "sage-cream",
  accent_color: null,
};

export async function getSettings(): Promise<SiteSettings> {
  try {
    const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings");
    const map: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      try {
        map[r.key] = JSON.parse(r.value);
      } catch {
        /* ignore malformed */
      }
    }
    return map as SiteSettings;
  } catch {
    // No database yet (e.g. build-time prerendering before first boot) -
    // fall back to defaults so renders never crash on missing infrastructure.
    return { ...DEFAULT_SETTINGS };
  }
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  if (!row) return (DEFAULT_SETTINGS as Record<string, unknown>)[key] as T | undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    nowIso()
  );
}

export function whatsappLink(settings: SiteSettings): string {
  return `https://wa.me/${settings.phone_intl.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
    settings.whatsapp_greeting
  )}`;
}

export function telLink(settings: SiteSettings): string {
  return `tel:${settings.contact_phone_display.replace(/\s/g, "")}`;
}

/**
 * THE canonical standard drop-in price: the active `drop_in` product row that
 * Anne edits in Admin → Pricing. settings.drop_in_cents is only a legacy
 * bootstrap fallback so the engine never has no price at all.
 */
export async function getDropInPriceCents(): Promise<number> {
  const row = get<{ price_cents: number }>(
    `SELECT price_cents FROM products WHERE kind = 'drop_in' AND active = 1 ORDER BY is_default DESC, sort ASC, id ASC LIMIT 1`
  );
  if (row && Number.isFinite(row.price_cents) && row.price_cents >= 0) return row.price_cents;
  return DEFAULT_SETTINGS.drop_in_cents;
}

export type PrimaryVenue = {
  id: number;
  name: string;
  address: string | null;
  postcode: string | null;
  map_url: string | null;
  directions: string | null;
  parking_notes: string | null;
  access_notes: string | null;
};

/** The owner-managed primary venue - the ONLY source for venue facts on public pages. */
export async function getPrimaryVenue(): Promise<PrimaryVenue | null> {
  const settings = await getSettings();
  const row = settings.primary_venue_id
    ? get<PrimaryVenue>(`SELECT id, name, address, postcode, map_url, directions, parking_notes, access_notes FROM venues WHERE id = ? AND active = 1`, settings.primary_venue_id)
    : get<PrimaryVenue>(`SELECT id, name, address, postcode, map_url, directions, parking_notes, access_notes FROM venues WHERE active = 1 ORDER BY id LIMIT 1`);
  return row ?? null;
}

const DAY_NAMES = ["", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

/**
 * Human summary of the regular weekly schedule, DERIVED from active class
 * series - never hard-coded. e.g. "Tue & Thu, 7.30–8.30 pm" (day names derived).
 */
export async function getWeeklyScheduleSummary(tz?: string): Promise<string> {
  const settings = tz ? { timezone: tz } : await getSettings();
  const series = all<{ weekdays: string; start_time: string; end_time: string }>(
    `SELECT weekdays, start_time, end_time FROM class_series WHERE status = 'active' AND publication_status = 'published'`
  );
  const groups = new Map<string, number[]>();
  for (const s of series) {
    const days = JSON.parse(s.weekdays) as number[];
    const key = `${s.start_time}–${s.end_time}`;
    groups.set(key, [...(groups.get(key) ?? []), ...days]);
  }
  const parts: string[] = [];
  const { fmtTimeRange, zonedToUtc, utcToZoned } = await import("./tz");
  for (const [time, days] of groups) {
    const unique = [...new Set(days)].sort((a, b) => a - b);
    const dayNames = unique.map((d) => DAY_NAMES[d] ?? "");
    const dayLabel =
      dayNames.length > 1
        ? `${dayNames.slice(0, -1).join(", ")} & ${dayNames[dayNames.length - 1]}`
        : dayNames[0] ?? "";
    // sample instant to render the local time range across DST correctly
    const sample = zonedToUtc(2026, 7, 7, Number(time.split("–")[0].split(":")[0]), Number(time.split("–")[0].split(":")[1] ?? 0), settings.timezone);
    const sampleEnd = zonedToUtc(2026, 7, 7, Number(time.split("–")[1].split(":")[0]), Number(time.split("–")[1].split(":")[1] ?? 0), settings.timezone);
    const range = fmtTimeRange(sample, sampleEnd, settings.timezone);
    parts.push(`${dayLabel}, ${range}`);
  }
  if (parts.length === 0) return "";
  return parts.join(" · ");
}

/** Is the automatic multi-date discount switched on? Public copy adapts to it. */
export async function isMultiDateDiscountActive(): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.multi_date_discount_enabled) return false;
  const row = get<{ active: number }>(`SELECT active FROM discount_rules WHERE kind = 'multi_date' LIMIT 1`);
  return !!row && row.active === 1;
}
