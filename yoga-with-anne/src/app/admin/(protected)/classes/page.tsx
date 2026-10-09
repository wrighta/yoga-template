import Link from "next/link";
import { all } from "@/db";
import { Card, Alert } from "@/components/ui";
import { fmtDateTime, fmtDate } from "@/lib/tz";
import { getSettings } from "@/lib/settings";
import { cancelOccurrenceAction } from "@/app/admin/actions";
import { updateBlockAction, toggleBundleAction, setBundlePublicationAction } from "@/app/admin/actions-setup";
import { getBlockView, getBundleView } from "@/lib/blocks";
import { fmtEuro } from "@/lib/money";

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; show?: string; cancelled?: string; notified?: string; error?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "classes" ? "classes" : "blocks"; // blocks is the default
  const showHistory = sp.show === "past";
  const settings = await getSettings();

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
  const upcomingBlocks = blocksList.filter((b) => b.publication_status === "draft" || (b.active && b.onSale));
  const offSaleBlocks = blocksList.filter((b) => b.active && !b.onSale);
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
            href={tabLink("blocks")}
            role="tab"
            aria-selected={view === "blocks"}
            className={`min-h-[40px] rounded-full px-5 py-2 text-sm font-semibold ${view === "blocks" ? "bg-forest-800 text-white" : "text-forest-800 hover:bg-sage-100"}`}
          >
            Blocks (default)
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
                      <p className="text-xs font-semibold uppercase text-bark-500">{b.publication_status}</p>
                      <p className="text-sm text-bark-500">
                        {b.dates[0]?.displayDate} – {b.dates[b.dates.length - 1]?.displayDate} · {b.classCount} classes ·{" "}
                        {b.venueName ?? ""}
                      </p>
                      <p className="mt-1 text-sm text-bark-700">
                        <strong>{fmtEuro(b.price_cents)}</strong> whole block (≈ {fmtEuro(b.perClassCents)} per class) ·{" "}
                        {b.stateLabel}
                        {b.waitlistDates > 0 ? ` · ${b.waitlistDates} date${b.waitlistDates === 1 ? "" : "s"} full (waitlisted)` : ""}
                      </p>
                    </div>
                  </div>

                  {/* inline edit */}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-forest-800 underline underline-offset-4">
                      Edit block (dates, price, re-advertise)
                    </summary>
                    <form action={updateBlockAction} className="mt-3 grid items-end gap-3 sm:grid-cols-6">
                      <input type="hidden" name="id" value={b.id} />
                      <div className="sm:col-span-2">
                        <label className="text-xs font-semibold text-bark-500">Block name</label>
                        <input name="name" defaultValue={b.name} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-bark-500">First class date</label>
                        <input name="startDate" type="date" defaultValue={b.start_date} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-bark-500">Last class date</label>
                        <input name="endDate" type="date" defaultValue={b.end_date} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-bark-500">Whole block (€)</label>
                        <input name="price" defaultValue={(b.price_cents / 100).toFixed(2)} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-bark-500">Visibility</label>
                        <select name="publicationStatus" defaultValue={b.publication_status} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm">
                          <option value="draft">Draft</option>
                          <option value="published">Published</option>
                        </select>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input type="checkbox" name="active" defaultChecked={!!b.active} className="h-4 w-4 accent-forest-800" /> On sale
                        </label>
                        <button type="submit" className="rounded-full bg-forest-800 px-4 py-2 text-xs font-semibold text-white">Save</button>
                      </div>
                    </form>
                  </details>
                </Card>
              ))}

              {offSaleBlocks.length > 0 && (
                <Card className="p-5">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-bark-500">Off sale / finished</h2>
                  <ul className="mt-2 space-y-1 text-sm text-bark-500">
                    {offSaleBlocks.map((b) => (
                      <li key={b.id}>{b.name} - {b.stateLabel}</li>
                    ))}
                  </ul>
                </Card>
              )}

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
