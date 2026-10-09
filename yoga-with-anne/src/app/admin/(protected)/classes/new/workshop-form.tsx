"use client";

import { useMemo, useState } from "react";
import { createSmartWorkshopAction } from "@/app/admin/actions-workshops";
import { Alert, Field } from "@/components/ui";
import { ComboSelect } from "@/components/combo-select";
import { MediaPicker } from "@/components/media-picker";

type Option = { id: number; name: string };
type MediaOption = { id: number; alt: string; mime: string };

function retreatDates(start: string, end: string): string[] {
  if (!start || !end || end < start) return [];
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last && dates.length < 367) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function WorkshopForm({
  classTypes,
  instructors,
  venues,
  media,
  defaultVenueId,
}: {
  classTypes: Option[];
  instructors: Option[];
  venues: Option[];
  media: MediaOption[];
  defaultVenueId?: number;
}) {
  const [kind, setKind] = useState<"workshop" | "retreat">("workshop");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [differentTimes, setDifferentTimes] = useState(false);
  const [dailyStart, setDailyStart] = useState("");
  const [dailyEnd, setDailyEnd] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const retreatDayList = useMemo(() => retreatDates(startDate, endDate), [startDate, endDate]);
  const singleDay = !!startDate && startDate === endDate;
  const multiDay = retreatDayList.length > 1;

  // Validate in the browser so a mistake never costs the teacher the text they have typed.
  function validateBeforeSubmit(event: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const bad = (start: FormDataEntryValue | null, end: FormDataEntryValue | null) => !start || !end || String(start) >= String(end);
    let message: string | null = null;
    if (endDate && startDate && endDate < startDate) {
      message = "The end date can't be before the start date.";
    } else if (kind === "workshop" && bad(data.get("workshopStartTime"), data.get("workshopEndTime"))) {
      message = "The end time must be after the start time. Times use the 24-hour clock, e.g. 13:00 to 16:00.";
    } else if (kind === "retreat" && !differentTimes && bad(data.get("dailyStartTime"), data.get("dailyEndTime"))) {
      message = "The end time must be after the start time. Times use the 24-hour clock, e.g. 13:00 to 16:00 (4:00 would be 4 AM).";
    } else if (kind === "retreat" && differentTimes) {
      const starts = data.getAll("dailyTimeStart");
      const ends = data.getAll("dailyTimeEnd");
      if (starts.some((start, index) => bad(start, ends[index]))) message = "Each day's end time must be after its start time (24-hour clock).";
    }
    setFormError(message);
    if (message) {
      event.preventDefault();
      event.currentTarget.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const dateFormatter = new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "short" });
  const rangeLabel = startDate && endDate && endDate >= startDate
    ? startDate === endDate
      ? dateFormatter.format(new Date(`${startDate}T12:00:00`))
      : `${dateFormatter.format(new Date(`${startDate}T12:00:00`))} – ${dateFormatter.format(new Date(`${endDate}T12:00:00`))}`
    : "";

  return (
    <form action={createSmartWorkshopAction} onSubmit={validateBeforeSubmit} className="grid gap-4 sm:grid-cols-2">
      {formError ? <div className="sm:col-span-2"><Alert kind="error">{formError}</Alert></div> : null}      <Field label="Name (students see this)" name="name" required placeholder="e.g. Slow Flow Sunday Reset" className="sm:col-span-2" />
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
        Type
        <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as "workshop" | "retreat")} className="rounded-xl border border-oat-300 px-4 py-3">
          <option value="workshop">Workshop</option>
          <option value="retreat">Retreat</option>
        </select>
      </label>

      <ComboSelect
        label="Class type / style"
        name="classTypeId"
        options={classTypes}
        newPlaceholder="e.g. Slow Flow"
        required
      />
      <ComboSelect
        label="Instructor"
        name="instructorId"
        options={instructors}
        newPlaceholder="e.g. Mary Byrne"
      />

      <Field label="Start date" name="startDate" type="date" value={startDate} onChange={(value) => { setStartDate(value); if (!endDate || endDate < value) setEndDate(value); }} required />
      <Field label="End date" name="endDate" type="date" value={endDate} onChange={setEndDate} required hint="Same as the start date for a one-day event." />
      {kind === "workshop" ? (
        <fieldset className="grid gap-4 rounded-lg border border-oat-200 p-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-forest-900">Workshop hours</legend>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">Start time<input type="time" name="workshopStartTime" required className="rounded-xl border border-oat-300 px-4 py-3" /></label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">End time<input type="time" name="workshopEndTime" required className="rounded-xl border border-oat-300 px-4 py-3" /></label>
        </fieldset>
      ) : null}
      {kind === "retreat" ? (
        <fieldset className="grid gap-4 rounded-lg border border-oat-200 p-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-forest-900">{multiDay ? "Daily retreat times" : "Retreat hours"}</legend>
          {multiDay ? (
            <label className="flex items-center gap-2 text-sm font-medium text-forest-900 sm:col-span-2">
              <input type="checkbox" name="differentTimes" checked={differentTimes} onChange={(event) => setDifferentTimes(event.target.checked)} className="h-5 w-5 accent-forest-800" />
              Different start and end times each day
            </label>
          ) : null}
          {!differentTimes || !multiDay ? (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">{multiDay ? "Start time each day" : "Start time"}<input type="time" name="dailyStartTime" value={dailyStart} onChange={(event) => setDailyStart(event.target.value)} required className="rounded-xl border border-oat-300 px-4 py-3" /></label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">{multiDay ? "End time each day" : "End time"}<input type="time" name="dailyEndTime" value={dailyEnd} onChange={(event) => setDailyEnd(event.target.value)} required className="rounded-xl border border-oat-300 px-4 py-3" /></label>
              <p className="text-xs text-bark-500 sm:col-span-2">24-hour clock, e.g. 16:00 is 4 PM.</p>
            </>
          ) : retreatDayList.length > 0 ? (
            <div className="space-y-3 sm:col-span-2">
              {retreatDayList.map((date) => {
                const label = new Intl.DateTimeFormat("en-IE", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
                return (
                  <div key={date} className="grid items-end gap-3 rounded-lg bg-oat-50 p-3 sm:grid-cols-[minmax(0,1fr)_1fr_1fr]">
                    <span className="pb-3 text-sm font-semibold text-forest-900">{label}<input type="hidden" name="dailyTimeDate" value={date} /></span>
                    <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">Start<input type="time" name="dailyTimeStart" defaultValue={dailyStart} required className="min-w-0 rounded-xl border border-oat-300 px-3 py-3" /></label>
                    <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">End<input type="time" name="dailyTimeEnd" defaultValue={dailyEnd} required className="min-w-0 rounded-xl border border-oat-300 px-3 py-3" /></label>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-sm text-bark-500 sm:col-span-2">Choose the retreat start and end dates to enter each day&apos;s times.</p>}
        </fieldset>
      ) : null}
      <Field label="Capacity" name="capacity" type="number" defaultValue="14" required />
      <ComboSelect
        label="Venue"
        name="venueId"
        options={venues}
        defaultSelected={defaultVenueId}
        newPlaceholder="e.g. Lucan Soccer Club"
        extraNewField={{ name: "venueMapUrl", label: "Google Maps link (optional)", placeholder: "https://maps.google.com/?q=…" }}
      />
      <Field label={`Price (€), whole ${kind}`} name="price" required placeholder="45.00" />
      <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2">
        <Field label="Early-bird price (€, optional)" name="earlyBirdPrice" placeholder="35.00" />
        <Field label="Early-bird deadline (optional)" name="earlyBirdUntil" type="date" hint="Students pay the early-bird price if they book on or before this date." />
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
        Short teaser (shown on the Workshops &amp; Retreats listing)
        <textarea name="summary" rows={2} maxLength={300} className="rounded-xl border border-oat-300 px-4 py-3 font-normal" placeholder="One or two sentences to catch interest…" />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
        Itinerary and details (shown on the event page under &ldquo;About this {kind}&rdquo;)
        <textarea name="description" rows={6} className="rounded-xl border border-oat-300 px-4 py-3 font-normal" placeholder="Describe the event, the itinerary, and what to expect…" />
      </label>

      <div className="sm:col-span-2">
        <MediaPicker label="Event image (optional)" name="imageMediaId" media={media} currentId={null} help="Shown on the public event listing." />
      </div>

      <div className="rounded-[var(--radius-card)] bg-sage-100 p-4 sm:col-span-2" data-testid="workshop-preview">
        <p className="text-sm font-semibold text-forest-900">
          {rangeLabel ? `This ${kind} runs ${rangeLabel}:` : "Choose the start and end dates to see a preview."}
        </p>
        {rangeLabel ? <p className="mt-1 text-xs text-forest-800">One booking covers the whole event.</p> : null}
      </div>

      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button type="submit" name="publicationStatus" value="draft" disabled={pending} className="min-h-[48px] rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800 hover:bg-sage-100 disabled:opacity-50">
          {pending ? "Saving…" : "Save draft"}
        </button>
        <button type="submit" name="publicationStatus" value="published" disabled={pending} className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900 disabled:opacity-50">
          {pending ? "Publishing…" : `Publish ${kind}`}
        </button>
      </div>
    </form>
  );
}
