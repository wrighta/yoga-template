import Link from "next/link";
import { all, get } from "@/db";
import { Card, Alert, Field } from "@/components/ui";
import { createSeriesAction, addOccurrenceAction } from "@/app/admin/actions";
import { updateSeriesAction, generateMoreForSeriesAction, duplicateSeriesAction, createBundleAction } from "@/app/admin/actions-setup";
import { createSmartBlockAction } from "@/app/admin/actions-blocks";
import { SmartBlockForm } from "./smart-block-form";
import { WorkshopForm } from "./workshop-form";
import { listMedia } from "@/lib/media";
import { SeriesCreateForm } from "../series-create-form";
import { ComboSelect } from "@/components/combo-select";
import { getBlockView } from "@/lib/blocks";
import { getDropInPriceCents } from "@/lib/settings";
import { fmtEuro } from "@/lib/money";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function AdminCreateClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; created?: string }>;
}) {
  const sp = await searchParams;
  const dropInStandard = ((await getDropInPriceCents()) / 100).toFixed(2);
  const media = listMedia().map((m) => ({ id: m.id, alt: m.alt, mime: m.mime }));

  const classTypes = all<{ id: number; name: string }>(`SELECT id, name FROM class_types WHERE active = 1`);
  const venues = all<{ id: number; name: string }>(`SELECT id, name FROM venues WHERE active = 1`);
  const instructors = all<{ id: number; name: string }>(`SELECT id, name FROM instructors WHERE active = 1`);
  const series = all<{ id: number; title: string; weekdays: string; start_time: string; end_time: string; capacity: number; price_override_cents: number | null; waitlist_enabled: number; status: string; publication_status: "draft" | "published"; skip_dates: string | null; venue_id: number | null; instructor_id: number | null }>(
    `SELECT * FROM class_series ORDER BY status ASC, id ASC`
  );
  const blockRows = all<{ id: number }>(`SELECT id FROM class_blocks ORDER BY start_date DESC`);
  const blocksList = (await Promise.all(blockRows.map((r) => getBlockView(r.id)))).filter((b): b is NonNullable<typeof b> => !!b);
  const defaultVenue = get<{ id: number }>(`SELECT id FROM venues ORDER BY id LIMIT 1`);
  const defaultType = get<{ id: number }>(`SELECT id FROM class_types ORDER BY id LIMIT 1`);
  const defaultInstructor = get<{ id: number }>(`SELECT id FROM instructors ORDER BY id LIMIT 1`);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold text-forest-900">Create classes</h1>
      </div>
      <div role="tablist" aria-label="Classes and events" className="inline-flex rounded-full border border-oat-300 bg-white p-1">
        <Link href="/admin/classes/new" role="tab" aria-selected="true" className="min-h-[40px] rounded-full bg-forest-800 px-5 py-2 text-sm font-semibold text-white">
          Create new
        </Link>
        <Link href="/admin/classes?view=blocks" role="tab" aria-selected="false" className="min-h-[40px] rounded-full px-5 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100">
          View &amp; edit blocks, workshops &amp; retreats
        </Link>
        <Link href="/admin/classes?view=classes" role="tab" aria-selected="false" className="min-h-[40px] rounded-full px-5 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100">
          Individual classes
        </Link>
      </div>
      {sp.error ? <Alert kind="error">{sp.error}</Alert> : null}
      {sp.saved ? <Alert kind="success">Saved.</Alert> : null}
      {sp.created ? <Alert kind="success">{sp.created === "1" ? "Class created." : `${sp.created} classes created.`}</Alert> : null}
      <Alert kind="info">
        Create a block and choose whether students book the whole block or can also book individual dates. You can also
        create a workshop, retreat, single class, or a bundle of blocks.
      </Alert>

      <details className="rounded-[var(--radius-card)] border border-oat-200 bg-white" id="block">
        <summary className="cursor-pointer px-6 py-5 text-lg font-semibold text-forest-900">Create a block of classes</summary>
        <div className="space-y-4 border-t border-oat-100 p-6">
          <p className="text-sm text-bark-500">Choose the weekly days, time, term dates and total price. Every place is booked into all dates in the block.</p>
          <SmartBlockForm
            classTypes={classTypes.map((t) => ({ id: Number(t.id), name: String(t.name) }))}
            instructors={instructors.map((i) => ({ id: Number(i.id), name: String(i.name) }))}
            venues={venues.map((v) => ({ id: Number(v.id), name: String(v.name) }))}
            defaultVenueId={defaultVenue ? Number(defaultVenue.id) : undefined}
          />
        </div>
      </details>

      <details className="rounded-[var(--radius-card)] border border-oat-200 bg-white" id="workshop">
        <summary className="cursor-pointer px-6 py-5 text-lg font-semibold text-forest-900">Create a workshop or retreat</summary>
        <div className="space-y-4 border-t border-oat-100 p-6">
          <p className="text-sm text-bark-500">Set the dates, daily times, per-person price and itinerary. Event-specific class style, teacher, venue, and photo can be selected here.</p>
          <WorkshopForm
            classTypes={classTypes.map((t) => ({ id: Number(t.id), name: String(t.name) }))}
            instructors={instructors.map((i) => ({ id: Number(i.id), name: String(i.name) }))}
            venues={venues.map((v) => ({ id: Number(v.id), name: String(v.name) }))}
            media={media}
            defaultVenueId={defaultVenue ? Number(defaultVenue.id) : undefined}
          />
        </div>
      </details>

      <details className="rounded-[var(--radius-card)] border border-oat-200 bg-white" id="bundle">
        <summary className="cursor-pointer px-6 py-5 text-lg font-semibold text-forest-900">Create a bundle (multi-save)</summary>
        <div className="border-t border-oat-100 p-6">
        <p className="text-sm text-bark-500">Combine two or more existing blocks under one total price.</p>
        {blocksList.length < 2 ? (
          <p className="mt-4 rounded-xl bg-oat-100 px-4 py-3 text-sm text-bark-700">
            You need at least two blocks first - create them above.
          </p>
        ) : (
          <form action={createBundleAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Bundle name" name="name" required placeholder="e.g. Full programme - Tue + Thu" />
            <Field label="Bundle price (€)" name="price" required placeholder="150.00" />
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-semibold text-forest-900">Include which blocks? (pick 2 or more)</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {blocksList.map((b) => (
                  <label key={b.id} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-oat-300 px-3 text-sm">
                    <input type="checkbox" name="blockIds" value={b.id} className="h-4 w-4 accent-forest-800" />
                    {b.name} · {fmtEuro(b.price_cents)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <button type="submit" name="publicationStatus" value="draft" className="min-h-[48px] rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800 hover:bg-sage-100">Save draft</button>
              <button type="submit" name="publicationStatus" value="published" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900">Publish bundle</button>
            </div>
          </form>
        )}
        </div>
      </details>

      <details className="rounded-[var(--radius-card)] border border-oat-200 bg-white">
        <summary className="cursor-pointer px-6 py-5 text-sm font-semibold text-bark-700">More class options</summary>
        <div className="space-y-4 border-t border-oat-100 p-6">
      <details className="rounded-lg border border-oat-200" id="series">
        <summary className="cursor-pointer px-4 py-3 font-semibold text-forest-900">Create a standalone weekly drop-in schedule</summary>
        <div className="border-t border-oat-100 p-4">
        <p className="mb-4 text-sm text-bark-500">Use this only when you want students to book weekly class dates individually, without selling them as a block.</p>
          <SeriesCreateForm
            classTypes={classTypes.map((t) => ({ id: Number(t.id), name: String(t.name) }))}
            venues={venues.map((v) => ({ id: Number(v.id), name: String(v.name) }))}
            instructors={instructors.map((i) => ({ id: Number(i.id), name: String(i.name) }))}
            defaultTypeId={defaultType ? Number(defaultType.id) : undefined}
            defaultVenueId={defaultVenue ? Number(defaultVenue.id) : undefined}
            defaultInstructorId={defaultInstructor ? Number(defaultInstructor.id) : undefined}
            standardPrice={dropInStandard}
          />
        </div>
      </details>

      <details className="rounded-[var(--radius-card)] border border-oat-200 bg-white" id="single">
        <summary className="cursor-pointer px-6 py-5 text-lg font-semibold text-forest-900">Add a single class</summary>
        <div className="border-t border-oat-100 p-6">
        <p className="text-sm text-bark-500">Create a one-off class date with its own time, price and capacity.</p>
        <form action={addOccurrenceAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Title" name="title" required defaultValue="Gentle Yoga & Meditation" className="sm:col-span-2" />
          <Field label="Date" name="date" type="date" required />
          <Field label="Capacity" name="capacity" type="number" defaultValue="12" required />
          <Field label="Start time" name="startTime" type="time" defaultValue="19:30" required />
          <Field label="End time" name="endTime" type="time" defaultValue="20:30" required />
          <Field label="Price (€)" name="priceOverride" placeholder={dropInStandard} hint={`Leave blank to use your standard ${dropInStandard}.`} />
          <Field label="Public note (shown on the class page)" name="notesPublic" placeholder="e.g. bring a blanket" className="sm:col-span-2" />
          <ComboSelect
            label="Class type / style"
            name="classTypeId"
              options={classTypes.map((t) => ({ id: Number(t.id), name: String(t.name) }))}
            newPlaceholder="e.g. Restorative Yoga"
            required
          />
          <ComboSelect
            label="Instructor"
            name="instructorId"
            options={instructors.map((i) => ({ id: Number(i.id), name: String(i.name) }))}
            newPlaceholder="e.g. Mary Byrne"
          />
          <ComboSelect
            label="Venue"
            name="venueId"
            options={venues.map((v) => ({ id: Number(v.id), name: String(v.name) }))}
            defaultSelected={defaultVenue ? Number(defaultVenue.id) : undefined}
            newPlaceholder="e.g. Lucan Soccer Club"
            extraNewField={{ name: "venueMapUrl", label: "Google Maps link (optional)", placeholder: "https://maps.google.com/?q=…" }}
          />
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <button type="submit" name="publicationStatus" value="draft" className="min-h-[48px] rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800 hover:bg-sage-100">Save draft</button>
            <button type="submit" name="publicationStatus" value="published" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900">Publish class</button>
          </div>
        </form>
        </div>
      </details>

      {/* Advanced weekly schedule management */}
      <details className="rounded-lg border border-oat-200 bg-white" id="series-manage">
        <summary className="cursor-pointer px-4 py-3 font-semibold text-forest-900">Advanced weekly schedule tools</summary>
        <div className="border-t border-oat-100 p-4">
        <p className="text-sm text-bark-500">
          These tools are for standalone weekly drop-in schedules. You do not need them for a block; its dates and
          booking options are managed together from Schedule.
        </p>
        <div className="mt-4 space-y-4">
          {series.map((sr) => {
            const weekdays = JSON.parse(sr.weekdays) as number[];
            const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].filter((_, i) => weekdays.includes(i + 1)).join(", ");
            const futureCount = get<{ c: number }>(`SELECT COUNT(*) AS c FROM class_occurrences WHERE series_id = ? AND starts_at >= datetime('now')`, sr.id)!.c;
            return (
              <div key={sr.id} id={`series-${sr.id}`} className={`rounded-xl border p-4 ${sr.status === "retired" ? "border-oat-200 opacity-70" : "border-oat-300"}`}>
                <details>
                  <summary className="cursor-pointer font-semibold text-forest-900">
                    {sr.title}{" "}
                    <span className="ml-2 text-xs font-normal text-bark-500">
                      {dayNames} · {sr.start_time}–{sr.end_time} · cap {sr.capacity} · {futureCount} upcoming · {sr.publication_status}
                      {sr.status === "retired" ? " · retired (no new dates generated)" : ""}
                    </span>
                  </summary>
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <form action={updateSeriesAction} className="grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="id" value={sr.id} />
                      <Field label="Series name" name="title" defaultValue={sr.title} className="sm:col-span-2" />
                      <Field label="Capacity for new dates" name="capacity" type="number" defaultValue={String(sr.capacity)} />
                      <Field label="Price per class (€, optional)" name="priceOverrideRaw" type="number" step="0.01" defaultValue={sr.price_override_cents ? (sr.price_override_cents / 100).toFixed(2) : ""} />
                      <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
                        Visibility
                        <select name="publicationStatus" defaultValue={sr.publication_status} className="rounded-xl border border-oat-300 px-4 py-3 text-sm">
                          <option value="draft">Draft</option>
                          <option value="published">Published</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
                        Venue for new dates
                        <select name="venueId" defaultValue={String(sr.venue_id ?? "")} className="rounded-xl border border-oat-300 px-4 py-3 text-sm">
                          <option value="">- none -</option>
                          {venues.map((v) => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
                        Instructor for new dates
                        <select name="instructorId" defaultValue={String(sr.instructor_id ?? "")} className="rounded-xl border border-oat-300 px-4 py-3 text-sm">
                          <option value="">- none -</option>
                          {instructors.map((i) => (
                            <option key={i.id} value={i.id}>{i.name}</option>
                          ))}
                        </select>
                      </label>
                      <Field
                        label="Skip dates (holidays)"
                        name="skipDates"
                        defaultValue={sr.skip_dates ? (JSON.parse(sr.skip_dates) as string[]).join(", ") : ""}
                        className="sm:col-span-2"
                        hint="Comma-separated dates (YYYY-MM-DD) that should never be generated for this series."
                      />
                      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" name="active" defaultChecked={sr.status === "active"} className="h-5 w-5 rounded accent-forest-800" /> Active
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" name="waitlist" defaultChecked={!!sr.waitlist_enabled} className="h-5 w-5 rounded accent-forest-800" /> Waitlist
                        </label>
                        <button type="submit" className="min-h-[44px] rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Save series</button>
                      </div>
                    </form>
                    <div className="flex flex-col gap-4 rounded-xl bg-oat-50 p-4">
                      <form action={generateMoreForSeriesAction} id="topup-form" className="grid gap-3">
                        <input type="hidden" name="id" value={sr.id} />
                        <p className="text-sm font-semibold text-forest-900">Fill the calendar forward</p>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="From" name="fromDate" type="date" required />
                          <Field label="To" name="toDate" type="date" required />
                        </div>
                        <button type="submit" className="min-h-[40px] rounded-full bg-forest-800 px-5 py-2 text-xs font-semibold text-white">Generate dates</button>
                      </form>
                      <form action={duplicateSeriesAction}>
                        <input type="hidden" name="id" value={sr.id} />
                        <button type="submit" className="text-xs font-semibold text-forest-800 underline underline-offset-4">Duplicate series (creates an inactive copy)</button>
                      </form>
                    </div>
                  </div>
                </details>
              </div>
            );
          })}
          {series.length === 0 && <p className="text-sm text-bark-500">No series yet - create one above.</p>}
        </div>
        </div>
      </details>
        </div>
      </details>
    </div>
  );
}
