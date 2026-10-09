import Link from "next/link";
import { all } from "@/db";
import { Card, Alert } from "@/components/ui";
import { fmtDateTime, fmtDate } from "@/lib/tz";
import { getSettings } from "@/lib/settings";
import { cancelOccurrenceAction } from "@/app/admin/actions";
import { updateBlockAction, toggleBundleAction, setBundlePublicationAction } from "@/app/admin/actions-setup";
import { getBlockView, getBundleView } from "@/lib/blocks";
import { fmtEuro } from "@/lib/money";
import { listMedia } from "@/lib/media";
import { MediaPicker } from "@/components/media-picker";

function sameTimes(json: string | null): { start: string; end: string } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { mode?: string; start?: string; end?: string };
    return parsed.mode === "same" && parsed.start && parsed.end ? { start: parsed.start, end: parsed.end } : null;
  } catch {
    return null;
  }
}

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; show?: string; cancelled?: string; notified?: string; error?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "classes" ? "classes" : "blocks"; // blocks is the default
  const showHistory = sp.show === "past";
  const settings = await getSettings();
  const media = listMedia().map((m) => ({ id: m.id, alt: m.alt, mime: m.mime }));

  // Upcoming scheduled classes (cancelled hidden unless history is on)
  const upcoming = all<{
    id: number; title: string; starts_at: string; ends_at: string; capacity: number; status: string;
    booked: number; held: number; waitlist: number; source: string; series_id: number | null;
    publication_status: string; series_publication_status: string | null;
  }>(
    `SELECT o.id, o.title, o.starts_at, o.ends_at, o.capacity, o.status, o.source, o.series_id,
       o.publication_status, s.publication_status AS series_publication_status,
      (SELECT COALESCE(SUM(b.seat_count),0) FROM bookings b WHERE b.occurrence_id = o.id AND b.status IN ('confirmed','attended')) AS booked,
       (SELECT COALESCE(SUM(h.qty),0) FROM capacity_holds h WHERE h.occurrence_id = o.id AND h.released = 0 AND h.expires_at > datetime('now')) AS held,
       (SELECT COUNT(*) FROM waitlist_entries w WHERE w.occurrence_id = o.id AND w.status = 'waiting') AS waitlist
    FROM class_occurrences o LEFT JOIN class_series s ON s.id = o.series_id
    WHERE o.starts_at >= datetime('now') AND (o.series_id IS NULL OR s.status = 'active') ${showHistory ? "" : "AND o.status = 'scheduled'"}
     ORDER BY o.starts_at ASC LIMIT 60`
  );
  // Past classes (only shown behind the history toggle)
  const past = showHistory
    ? all<{ id: number; title: string; starts_at: string; status: string; booked: number; attended: number }>(
        `SELECT o.id, o.title, o.starts_at, o.status,
           (SELECT COALESCE(SUM(b.seat_count),0) FROM bookings b WHERE b.occurrence_id = o.id AND b.status IN ('confirmed','attended')) AS booked,
           (SELECT COALESCE(SUM(b.seat_count),0) FROM bookings b WHERE b.occurrence_id = o.id AND b.status = 'attended') AS attended
         FROM class_occurrences o
         WHERE o.starts_at < datetime('now') OR o.status = 'cancelled'
         ORDER BY o.starts_at DESC LIMIT 30`
      )
    : [];

  const blockRows = all<{ id: number }>(`SELECT id FROM class_blocks ORDER BY start_date ASC`);
  const blocksList = (await Promise.all(blockRows.map((r) => getBlockView(r.id)))).filter((b): b is NonNullable<typeof b> => !!b);
  const upcomingBlocks = blocksList.filter((b) => !b.isPast);
  const bundleIds = all<{ id: number }>(`SELECT id FROM block_bundles WHERE active = 1 ORDER BY id DESC`);
  const bundlesList = (await Promise.all(bundleIds.map((r) => getBundleView(r.id)))).filter((b): b is NonNullable<typeof b> => !!b);

  const tabLink = (v: "blocks" | "classes") => `/admin/classes?view=${v}${showHistory ? "&show=past" : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold text-forest-900">Schedule</h1>
        <Link href="/admin/classes/new" className="inline-flex min-h-[44px] items-center rounded-full bg-forest-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-forest-900">
          + Create classes &amp; blocks
        </Link>
      </div>
      {sp.error ? <Alert kind="error">{sp.error}</Alert> : null}
      {sp.saved ? <Alert kind="success">Saved.</Alert> : null}
      {sp.cancelled ? <Alert kind="success">Class cancelled and attendees notified ({sp.notified ?? 0} emails queued).</Alert> : null}

      {/* View toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Schedule view" className="inline-flex rounded-full border border-oat-300 bg-white p-1">
          <Link
            href="/admin/classes/new"
            role="tab"
            aria-selected="false"
            className="min-h-[40px] rounded-full px-5 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100"
          >
            Create new
          </Link>
          <Link
            href={tabLink("blocks")}
            role="tab"
            aria-selected={view === "blocks"}
            className={`min-h-[40px] rounded-full px-5 py-2 text-sm font-semibold ${view === "blocks" ? "bg-forest-800 text-white" : "text-forest-800 hover:bg-sage-100"}`}
          >
            Blocks &amp; events
          </Link>
          <Link
            href={tabLink("classes")}
            role="tab"
            aria-selected={view === "classes"}
            className={`min-h-[40px] rounded-full px-5 py-2 text-sm font-semibold ${view === "classes" ? "bg-forest-800 text-white" : "text-forest-800 hover:bg-sage-100"}`}
          >
            Individual classes
          </Link>
        </div>
        <Link
          href={showHistory ? `/admin/classes?view=${view}` : `/admin/classes?view=${view}&show=past`}
          className="text-sm font-semibold text-bark-500 underline underline-offset-4"
        >
          {showHistory ? "Hide cancelled & past" : "Show cancelled & past"}
        </Link>
      </div>

      {view === "blocks" ? (
        <>
          {/* Blocks view */}
          {upcomingBlocks.length === 0 && bundlesList.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-bark-700">No blocks on sale yet.</p>
              <Link href="/admin/classes/new#block" className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-forest-800 px-5 py-2.5 text-sm font-semibold text-white">
                Create your first block →
              </Link>
            </Card>
          ) : (
            <div className="space-y-4">
              {upcomingBlocks.map((b) => (
                <Card key={b.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-forest-900">{b.name}</h2>
                      <p className="text-xs font-semibold uppercase text-bark-500">
                        {b.publication_status === "draft" ? "Draft" : !b.active ? "Not taking bookings" : b.stateLabel}
                      </p>
                      <p className="text-sm text-bark-500">
                        {b.dates[0]?.displayDate === b.dates[b.dates.length - 1]?.displayDate
                          ? b.dates[0]?.displayDate
                          : `${b.dates[0]?.displayDate} – ${b.dates[b.dates.length - 1]?.displayDate}`}
                        {b.kind === "block" ? ` · ${b.classCount} ${b.classCount === 1 ? "class" : "classes"}` : ""} ·{" "}
                        {b.venueName ?? ""}
                      </p>
                      <p className="mt-1 text-sm text-bark-700">
                        <strong>{fmtEuro(b.price_cents)}</strong>{" "}
                        {b.kind === "block" ? `whole block (≈ ${fmtEuro(b.perClassCents)} per class)` : "per person"}
                        {b.isEarlyBird ? ` · early bird ${fmtEuro(b.effectivePrice)} until ${b.early_bird_until}` : ""} ·{" "}
                        {b.stateLabel}
                        {b.waitlistDates > 0 ? ` · ${b.waitlistDates} date${b.waitlistDates === 1 ? "" : "s"} full (waitlisted)` : ""}
                      </p>
                    </div>
                  </div>

                  {/* inline edit */}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-forest-800 underline underline-offset-4">
                      Edit offering
                    </summary>
                    <form action={updateBlockAction} className="mt-3 grid items-end gap-3 sm:grid-cols-6">
                      <input type="hidden" name="id" value={b.id} />
                      <div className="sm:col-span-2">
                        <label className="text-xs font-semibold text-bark-500">{b.kind === "block" ? "Block name" : "Event name"}</label>
                        <input name="name" defaultValue={b.name} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-bark-500">{b.kind === "block" ? "First class date" : "Start date"}</label>
                        <input name="startDate" type="date" defaultValue={b.start_date} readOnly={b.kind !== "block"} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm read-only:bg-oat-50" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-bark-500">{b.kind === "block" ? "Last class date" : "End date"}</label>
                        <input name="endDate" type="date" defaultValue={b.end_date} readOnly={b.kind !== "block"} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm read-only:bg-oat-50" />
                      </div>
                      {b.kind === "block" ? (
                        <>
                          <div>
                            <label className="text-xs font-semibold text-bark-500">Start time</label>
                            <input name="startTime" type="time" defaultValue={b.startTime} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-bark-500">End time</label>
                            <input name="endTime" type="time" defaultValue={b.endTime} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                          </div>
                        </>
                      ) : null}
                      {b.kind === "block" ? (
                        <p className="text-xs text-bark-500 sm:col-span-6">
                          Changing class dates or times is only allowed before anyone books or joins the waitlist.
                        </p>
                      ) : (
                        <p className="text-xs text-bark-500 sm:col-span-6">
                          To change a workshop or retreat date after creating it, cancel the event and create it again.
                        </p>
                      )}
                      {b.kind !== "block" ? (
                        <>
                          <input type="hidden" name="eventFields" value="1" />
                          {sameTimes(b.daily_times_json) ? (
                            <>
                              <div>
                                <label className="text-xs font-semibold text-bark-500">Start time (24-hour)</label>
                                <input name="eventStartTime" type="time" defaultValue={sameTimes(b.daily_times_json)!.start} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="text-xs font-semibold text-bark-500">End time (24-hour)</label>
                                <input name="eventEndTime" type="time" defaultValue={sameTimes(b.daily_times_json)!.end} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                              </div>
                            </>
                          ) : null}
                          <div>
                            <label className="text-xs font-semibold text-bark-500">Early-bird price (€)</label>
                            <input name="earlyBirdPrice" defaultValue={b.early_bird_price_cents ? (b.early_bird_price_cents / 100).toFixed(2) : ""} placeholder="optional" className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-bark-500">Early-bird until</label>
                            <input name="earlyBirdUntil" type="date" defaultValue={b.early_bird_until ?? ""} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                          </div>
                          <div className="sm:col-span-6">
                            <label className="text-xs font-semibold text-bark-500">Short teaser (shown on the listing)</label>
                            <textarea name="summary" rows={2} maxLength={300} defaultValue={b.summary ?? ""} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                          </div>
                          <div className="sm:col-span-6">
                            <label className="text-xs font-semibold text-bark-500">Itinerary and details (shown on the event page)</label>
                            <textarea name="description" rows={6} defaultValue={b.description ?? ""} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                          </div>
                          <div className="sm:col-span-6">
                            <MediaPicker label="Event image" name="imageMediaId" media={media} currentId={b.image_media_id} />
                          </div>
                        </>
                      ) : null}
                      <div>
                        <label className="text-xs font-semibold text-bark-500">{b.kind === "block" ? "Whole block (€)" : "Event price (€)"}</label>
                        <input name="price" defaultValue={(b.price_cents / 100).toFixed(2)} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                      </div>
                      <input type="hidden" name="publicationStatus" value={b.publication_status} />
                      <input type="hidden" name="active" value={b.active ? "on" : ""} />
                      {b.kind === "block" ? (
                        <fieldset className="sm:col-span-4 rounded-xl border border-oat-200 p-3">
                          <legend className="px-1 text-xs font-semibold text-forest-900">Individual bookings</legend>
                          <label className="inline-flex items-start gap-2 text-xs text-bark-700">
                            <input type="checkbox" name="dropInsEnabled" defaultChecked={b.seriesPublicationStatus === "published"} className="mt-0.5 h-4 w-4 accent-forest-800" />
                            Also let students book single class dates
                          </label>
                        </fieldset>
                      ) : null}
                      <div>
                        <label className="text-xs font-semibold text-bark-500">
                          {b.kind === "block" ? "Whole-block bookings" : "Bookings"}
                        </label>
                        <select
                          name="offeringStatus"
                          defaultValue={b.publication_status === "draft" ? "draft" : b.active ? "on_sale" : "not_for_sale"}
                          className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm"
                        >
                          <option value="draft">Draft (not shown to students)</option>
                          <option value="on_sale">Accepting bookings</option>
                          <option value="not_for_sale">{b.kind === "block" ? "Not taking block bookings" : "Not accepting bookings"}</option>
                        </select>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="submit" className="rounded-full bg-forest-800 px-4 py-2 text-xs font-semibold text-white">Save</button>
                      </div>
                    </form>
                  </details>
                </Card>
              ))}

              {bundlesList.length > 0 && (
                <Card className="p-5">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-bark-500">Bundles on sale</h2>
                  <ul className="mt-2 space-y-2">
                    {bundlesList.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          <span className="font-semibold text-forest-900">{b.name}</span>
                          <span className="text-bark-500"> · {b.publication_status} · {b.blocks.map((bl) => bl.name).join(" + ")} · {b.classCount} classes</span>
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="font-semibold">{fmtEuro(b.price_cents)}</span>
                          <form action={setBundlePublicationAction} className="flex items-center gap-2">
                            <input type="hidden" name="id" value={b.id} />
                            <select name="publicationStatus" defaultValue={b.publication_status} aria-label={`Visibility for ${b.name}`} className="rounded-lg border border-oat-300 px-2 py-1 text-xs">
                              <option value="draft">Draft</option>
                              <option value="published">Published</option>
                            </select>
                            <button type="submit" className="text-xs font-semibold text-forest-800 underline underline-offset-4">Save</button>
                          </form>
                          <form action={toggleBundleAction}>
                            <input type="hidden" name="id" value={b.id} />
                            <button type="submit" className="text-xs font-semibold text-clay-700 underline underline-offset-4">Take off sale</button>
                          </form>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Individual classes view */}
          <Card className="overflow-hidden">
            <h2 className="px-6 pt-6 text-lg font-semibold text-forest-900">Upcoming classes</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-oat-100 bg-oat-50 text-left text-xs uppercase tracking-wider text-bark-500">
                    <th className="px-6 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Class</th>
                    <th className="px-4 py-3 font-semibold">Booked</th>
                    <th className="px-4 py-3 font-semibold">Waitlist</th>
                    <th className="px-6 py-3 font-semibold"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-oat-100">
                  {upcoming.map((c) => (
                    <tr key={c.id} className={c.status === "cancelled" ? "opacity-50" : ""}>
                      <td className="px-6 py-3 font-semibold text-forest-900">{fmtDate(c.starts_at, settings.timezone, true)}</td>
                      <td className="px-4 py-3">
                        {c.title}
                        <span className="block text-xs text-bark-500">{fmtDateTime(c.starts_at, c.ends_at, settings.timezone).split("·")[1]}{c.source === "manual" ? " · one-off" : ""} · {c.series_id ? c.series_publication_status : c.publication_status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={c.capacity - c.booked - c.held <= 0 ? "font-semibold text-clay-700" : c.capacity - c.booked - c.held <= 3 ? "font-semibold text-gold-700" : ""}>
                          {c.booked}/{c.capacity}
                        </span>
                        {c.held > 0 && <span className="ml-1 text-xs text-bark-300">+{c.held} held</span>}
                      </td>
                      <td className="px-4 py-3">{c.waitlist > 0 ? <span className="font-semibold text-clay-700">{c.waitlist}</span> : "-"}</td>
                      <td className="px-6 py-3 text-right">
                        <Link href={`/admin/classes/${c.id}`} className="font-semibold text-forest-800 underline underline-offset-4">Manage</Link>
                        {c.status !== "cancelled" ? (
                          <form action={cancelOccurrenceAction} className="mt-1">
                            <input type="hidden" name="id" value={c.id} />
                            <button type="submit" className="text-xs font-semibold text-clay-700 underline underline-offset-4">Cancel &amp; notify</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {upcoming.length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-6 text-center text-bark-500">No upcoming classes. <Link href="/admin/classes/new#series" className="underline">Create some →</Link></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {showHistory && past.length > 0 && (
            <Card className="overflow-hidden">
              <h2 className="px-6 pt-6 text-lg font-semibold text-forest-900">Past &amp; cancelled</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-oat-100 bg-oat-50 text-left text-xs uppercase tracking-wider text-bark-500">
                      <th className="px-6 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Class</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-6 py-3 font-semibold">Booked / attended</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-oat-100">
                    {past.map((c) => (
                      <tr key={c.id} className={c.status === "cancelled" ? "opacity-60" : ""}>
                        <td className="px-6 py-3 font-semibold text-forest-900">{fmtDate(c.starts_at, settings.timezone, true)}</td>
                        <td className="px-4 py-3">{c.title}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === "cancelled" ? "bg-oat-100 text-bark-500" : "bg-sage-100 text-forest-800"}`}>{c.status}</span>
                        </td>
                        <td className="px-6 py-3">{c.booked} / {c.attended}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      <p className="text-sm text-bark-500">
        Need to add or change what&apos;s on sale? <Link href="/admin/classes/new" className="font-semibold text-forest-800 underline underline-offset-4">Create classes &amp; blocks →</Link>
      </p>
    </div>
  );
}
