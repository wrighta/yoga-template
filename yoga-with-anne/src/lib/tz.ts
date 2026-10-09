/**
 * Timezone handling for Europe/Dublin (configurable via settings).
 * All storage is UTC; these helpers convert local wall-clock <-> UTC
 * correctly across Irish DST changes.
 */

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // ISO: 1=Mon .. 7=Sun
};

function tzOffsetMinutes(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second)
  );
  return Math.round((asUtc - utcMs) / 60000);
}

/** Convert local wall-clock parts in `tz` to a UTC ISO string. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): string {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let ms = naive - tzOffsetMinutes(naive, tz) * 60000;
  ms = naive - tzOffsetMinutes(ms, tz) * 60000; // re-check across DST boundary
  return new Date(ms).toISOString();
}

export function utcToZoned(iso: string, tz: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(iso))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    weekday: weekdays.indexOf(map.weekday) + 1,
  };
}

/** "Tue 6 Oct" (+ year when it differs from the current year). */
export function fmtDate(iso: string, tz: string, withYear = false): string {
  const p = utcToZoned(iso, tz);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][p.weekday - 1];
  const y = withYear ? ` ${p.year}` : "";
  return `${wd} ${p.day} ${months[p.month - 1]}${y}`;
}

function fmt12(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "am" : "pm";
  return minute === 0 ? `${h12} ${ampm}` : `${h12}.${String(minute).padStart(2, "0")} ${ampm}`;
}

/** "7.30–8.30 pm" (Irish style) */
export function fmtTimeRange(startIso: string, endIso: string, tz: string): string {
  const s = utcToZoned(startIso, tz);
  const e = utcToZoned(endIso, tz);
  const sTxt = fmt12(s.hour, s.minute);
  const eTxt = fmt12(e.hour, e.minute);
  const sameHalfDay = s.hour < 12 === e.hour < 12;
  if (sameHalfDay) {
    const sShort = sTxt.replace(/ (am|pm)$/, "");
    return `${sShort}–${eTxt}`;
  }
  return `${sTxt} – ${eTxt}`;
}

/** "Tue 6 Oct · 7.30–8.30 pm" */
export function fmtDateTime(startIso: string, endIso: string, tz: string): string {
  return `${fmtDate(startIso, tz)} · ${fmtTimeRange(startIso, endIso, tz)}`;
}

/**
 * "Same local wall-clock time, N days later" - DST-safe (unlike adding
 * 7×86400000 ms to the UTC timestamp, which shifts the local time across
 * Ireland's clock changes).
 */
export function addDaysLocal(iso: string, days: number, tz: string): string {
  const p = utcToZoned(iso, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), p.hour, p.minute, tz);
}

/** Local YYYY-MM-DD key for an instant. */
export function localDateKey(iso: string, tz: string): string {
  const p = utcToZoned(iso, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Local 'HH:MM' -> minutes */
export function parseHm(hm: string): { hour: number; minute: number } {
  const [h, m] = hm.split(":").map(Number);
  return { hour: h, minute: m ?? 0 };
}

/** Generate UTC start/end ISO pairs for given local weekdays between two local date keys (inclusive). */
export function generateOccurrences(opts: {
  weekdays: number[];
  startTime: string;
  endTime: string;
  fromDate: string; // local YYYY-MM-DD inclusive
  toDate: string; // local YYYY-MM-DD inclusive
  tz: string;
  skipDates?: string[]; // local date keys to skip
}): { startsAt: string; endsAt: string; dateKey: string }[] {
  const out: { startsAt: string; endsAt: string; dateKey: string }[] = [];
  const start = new Date(`${opts.fromDate}T00:00:00Z`);
  const end = new Date(`${opts.toDate}T00:00:00Z`);
  const st = parseHm(opts.startTime);
  const et = parseHm(opts.endTime);
  const skip = new Set(opts.skipDates ?? []);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const jsDow = d.getUTCDay(); // 0=Sun
    const isoDow = jsDow === 0 ? 7 : jsDow;
    const dateKey = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!opts.weekdays.includes(isoDow) || skip.has(dateKey)) continue;
    out.push({
      dateKey,
      startsAt: zonedToUtc(y, m, day, st.hour, st.minute, opts.tz),
      endsAt: zonedToUtc(y, m, day, et.hour, et.minute, opts.tz),
    });
  }
  return out;
}
