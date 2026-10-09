"use client";

import { useActionState, useState, useMemo } from "react";
import { createSeriesAction } from "@/app/admin/actions";
import { Field } from "@/components/ui";

type Option = { id: number; name: string };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Live preview of the exact dates a series will create (local calendar). */
function previewDates(weekdays: number[], fromDate: string, toDate: string): string[] {
  if (!fromDate || !toDate || weekdays.length === 0 || toDate < fromDate) return [];
  const out: string[] = [];
  const d = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  const fmt = new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "short" });
  let guard = 0;
  while (d <= end && guard < 400) {
    const jsDow = d.getDay(); // 0 = Sun
    const isoDow = jsDow === 0 ? 7 : jsDow;
    if (weekdays.includes(isoDow)) out.push(fmt.format(d));
    d.setDate(d.getDate() + 1);
    guard++;
  }
  return out;
}

export function SeriesCreateForm({
  classTypes,
  venues,
  instructors,
  defaultTypeId,
  defaultVenueId,
  defaultInstructorId,
  standardPrice,
}: {
  classTypes: Option[];
  venues: Option[];
  instructors: Option[];
  defaultTypeId?: number;
  defaultVenueId?: number;
  defaultInstructorId?: number;
  standardPrice: string;
}) {
  const [weekdays, setWeekdays] = useState<number[]>([2, 4]);
  const [fromDate, setFromDate] = useState("");
  const [endMode, setEndMode] = useState<"date" | "weeks">("weeks");
  const [toDate, setToDate] = useState("");
  const [weeks, setWeeks] = useState(8);

  const effectiveToDate = useMemo(() => {
    if (endMode === "date") return toDate;
    if (!fromDate || weeks < 1) return "";
    const end = new Date(`${fromDate}T00:00:00`);
    end.setDate(end.getDate() + weeks * 7 - 1);
    return end.toISOString().slice(0, 10);
  }, [endMode, fromDate, toDate, weeks]);

  const preview = useMemo(() => previewDates(weekdays, fromDate, effectiveToDate), [weekdays, fromDate, effectiveToDate]);

  return (
    <form action={createSeriesAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Series title" name="title" required defaultValue="Gentle Yoga & Meditation" className="sm:col-span-2" />

      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-semibold text-forest-900">Days of week</legend>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((d, i) => (
            <label key={d} className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-oat-300 px-3 text-sm font-medium">
              <input
                type="checkbox"
                name="weekdays"
                value={i + 1}
                checked={weekdays.includes(i + 1)}
                onChange={(e) => setWeekdays((prev) => (e.target.checked ? [...prev, i + 1].sort((a, b) => a - b) : prev.filter((x) => x !== i + 1)))}
                className="h-4 w-4 accent-forest-800"
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Start time" name="startTime" type="time" defaultValue="19:30" required />
      <Field label="End time" name="endTime" type="time" defaultValue="20:30" required />

      <div className="sm:col-span-2">
        <Field label="First date" name="fromDate" type="date" value={fromDate} onChange={setFromDate} required hint="Doesn't have to fall on a class day - the first ticked day on or after this date is used." />
      </div>

      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-semibold text-forest-900">How long does the block run?</legend>
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-oat-300 px-4 text-sm font-medium">
            <input type="radio" name="endMode" checked={endMode === "weeks"} onChange={() => setEndMode("weeks")} className="h-4 w-4 accent-forest-800" />
            Runs for
            <input
              type="number"
              min={1}
              max={52}
              value={weeks}
              onChange={(e) => setWeeks(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
              disabled={endMode !== "weeks"}
              name="weeks"
              className="w-16 rounded-lg border border-oat-300 px-2 py-1"
              aria-label="Number of weeks"
            />
            weeks
          </label>
          <label className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-oat-300 px-4 text-sm font-medium">
            <input type="radio" name="endMode" checked={endMode === "date"} onChange={() => setEndMode("date")} className="h-4 w-4 accent-forest-800" />
            Ends on
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={endMode !== "date"}
              name="toDate"
              className="rounded-lg border border-oat-300 px-2 py-1"
              aria-label="Last date"
            />
          </label>
        </div>
        <input type="hidden" name="toDate" value={effectiveToDate} />
      </fieldset>

      <Field label="Capacity" name="capacity" type="number" defaultValue="12" required />
      <Field label="Price per class (€)" name="priceOverride" placeholder={standardPrice} hint={`Leave blank to use your standard ${standardPrice} - or set a different price just for these classes.`} />

      <div className="sm:col-span-2">
        <Field
          label="Skip dates (optional)"
          name="skipDates"
          placeholder="e.g. 2026-12-22, 2026-12-29"
          hint="Holidays or break weeks - ticked days that fall on these dates are skipped. Format YYYY-MM-DD, comma-separated."
        />
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
        Class type
        <select name="classTypeId" className="rounded-xl border border-oat-300 px-4 py-3">
          {classTypes.map((t) => (
            <option key={t.id} value={t.id} selected={defaultTypeId === t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
        Venue
        <select name="venueId" className="rounded-xl border border-oat-300 px-4 py-3">
          {venues.map((v) => (
            <option key={v.id} value={v.id} selected={defaultVenueId === v.id}>{v.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
        Instructor
        <select name="instructorId" className="rounded-xl border border-oat-300 px-4 py-3">
          {instructors.map((i) => (
            <option key={i.id} value={i.id} selected={defaultInstructorId === i.id}>{i.name}</option>
          ))}
        </select>
      </label>

      {/* live preview */}
      <div className="rounded-[var(--radius-card)] bg-sage-100 p-4 sm:col-span-2" data-testid="series-preview">
        <p className="text-sm font-semibold text-forest-900">
          {preview.length > 0
            ? `This will create ${preview.length} class${preview.length === 1 ? "" : "es"}:`
            : "Choose your days and dates to see a preview."}
        </p>
        {preview.length > 0 && (
          <p className="mt-1 text-xs leading-relaxed text-forest-800">
            {preview.join(" · ")}
          </p>
        )}
        {preview.length > 0 && weekdays.length > 0 && (
          <p className="mt-1 text-xs text-bark-500">
            First: {preview[0]} · Last: {preview[preview.length - 1]}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button type="submit" name="publicationStatus" value="draft" className="min-h-[48px] rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800 hover:bg-sage-100">
          Save draft
        </button>
        <button type="submit" name="publicationStatus" value="published" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900">
          Publish schedule
        </button>
      </div>
    </form>
  );
}
