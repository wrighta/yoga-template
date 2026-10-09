"use client";

import { useMemo, useState } from "react";
import { createSmartBlockAction } from "@/app/admin/actions-blocks";
import { Alert, Field } from "@/components/ui";
import { ComboSelect } from "@/components/combo-select";

type Option = { id: number; name: string };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function previewDates(weekdays: number[], fromDate: string, toDate: string, skip: string[]): string[] {
  if (!fromDate || !toDate || weekdays.length === 0 || toDate < fromDate) return [];
  const skipSet = new Set(skip);
  const out: string[] = [];
  const d = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  const fmt = new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "short" });
  let guard = 0;
  while (d <= end && guard < 400) {
    const jsDow = d.getDay();
    const isoDow = jsDow === 0 ? 7 : jsDow;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (weekdays.includes(isoDow) && !skipSet.has(key)) out.push(fmt.format(d));
    d.setDate(d.getDate() + 1);
    guard++;
  }
  return out;
}

export function SmartBlockForm({
  classTypes,
  instructors,
  venues,
  defaultVenueId,
}: {
  classTypes: Option[];
  instructors: Option[];
  venues: Option[];
  defaultVenueId?: number;
}) {
  const [pending, setPending] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([2, 4]);
  const [fromDate, setFromDate] = useState("");
  const [endMode, setEndMode] = useState<"weeks" | "date">("weeks");
  const [weeks, setWeeks] = useState(8);
  const [toDate, setToDate] = useState("");
  const [skipDates, setSkipDates] = useState("");

  const effectiveToDate = useMemo(() => {
    if (endMode === "date") return toDate;
    if (!fromDate || weeks < 1) return "";
    const end = new Date(`${fromDate}T00:00:00`);
    end.setDate(end.getDate() + weeks * 7 - 1);
    return end.toISOString().slice(0, 10);
  }, [endMode, fromDate, toDate, weeks]);

  const preview = useMemo(() => previewDates(weekdays, fromDate, effectiveToDate, skipDates.split(/[\s,]+/).filter(Boolean)), [weekdays, fromDate, effectiveToDate, skipDates]);

  return (
    <form
      action={async (formData: FormData) => {
        setPending(true);
        try {
          await createSmartBlockAction(formData);
        } finally {
          setPending(false);
        }
      }}
      className="grid gap-4 sm:grid-cols-2"
    >

      <Field label="Block name (students see this)" name="name" required placeholder="e.g. Strong Yoga - Autumn evenings" className="sm:col-span-2" />

      <ComboSelect
        label="Class type / style"
        name="classTypeId"
        options={classTypes}
        newPlaceholder="e.g. Strong Yoga"
        required
        hint="Pick from your list, or just type a new style - it's created for you."
      />
      <ComboSelect
        label="Instructor"
        name="instructorId"
        options={instructors}
        newPlaceholder="e.g. Mary Byrne"
        hint="Pick from your list, or just type a name."
      />

      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-semibold text-forest-900">Which days does the block run?</legend>
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
        <Field label="First class date" name="startDate" type="date" value={fromDate} onChange={setFromDate} required hint="Doesn't have to fall on a class day - the first ticked day on or after it is used." />
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
              name="endDatePicker"
              className="rounded-lg border border-oat-300 px-2 py-1"
              aria-label="Last date"
            />
          </label>
        </div>
        <input type="hidden" name="endDate" value={effectiveToDate} />
      </fieldset>

      <div className="sm:col-span-2">
        <Field
          label="No class on (optional)"
          name="skipDates"
          value={skipDates}
          onChange={setSkipDates}
          placeholder="e.g. 2026-12-22, 2026-12-29"
          hint="Holidays or break weeks - ticked days falling on these dates are skipped."
        />
      </div>

      <Field label="Capacity" name="capacity" type="number" defaultValue="12" required />
      <ComboSelect
        label="Venue"
        name="venueId"
        options={venues.map((v) => ({ id: Number(v.id), name: String(v.name) }))}
        defaultSelected={defaultVenueId ?? undefined}
        newPlaceholder="e.g. Lucan Soccer Club"
        extraNewField={{ name: "venueMapUrl", label: "Google Maps link (optional)", placeholder: "https://maps.google.com/?q=…" }}
      />
      <Field label="Price for the WHOLE block (€)" name="price" required placeholder="80.00" className="sm:col-span-2" />

      <div className="rounded-[var(--radius-card)] bg-sage-100 p-4 sm:col-span-2" data-testid="series-preview">
        <p className="text-sm font-semibold text-forest-900">
          {preview.length > 0
            ? `This block will contain ${preview.length} class${preview.length === 1 ? "" : "es"}:`
            : "Choose your days and dates to see a preview."}
        </p>
        {preview.length > 0 && (
          <>
            <p className="mt-1 text-xs leading-relaxed text-forest-800">{preview.join(" · ")}</p>
            <p className="mt-1 text-xs text-bark-500">
              First: {preview[0]} · Last: {preview[preview.length - 1]}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button type="submit" name="publicationStatus" value="draft" disabled={pending} className="min-h-[48px] rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800 hover:bg-sage-100 disabled:opacity-50">
          {pending ? "Saving…" : "Save draft"}
        </button>
        <button type="submit" name="publicationStatus" value="published" disabled={pending} className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900 disabled:opacity-50">
          {pending ? "Publishing…" : "Publish block"}
        </button>
      </div>
    </form>
  );
}
