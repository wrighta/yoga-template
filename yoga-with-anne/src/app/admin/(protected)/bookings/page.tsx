import Link from "next/link";
import { all, get } from "@/db";
import { Card, Alert, Field } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/tz";
import { fmtEuro } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { adminBookingAction, adminBlockBookingAction, refundPaymentAction, cancelBookingAdminAction, transferEventBookingAction } from "@/app/admin/actions";
import { listActiveBlockViews, listActiveBundleViews, listWorkshopViews, blockView, type ClassBlock } from "@/lib/blocks";

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ offering?: string; q?: string; filter?: string; added?: string; count?: string; event?: string; cancelled?: string; refunded?: string; payment?: string; transferred?: string; refundDue?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { q, filter } = sp;
  const offeringId = /^\d+$/.test(sp.offering ?? "") ? sp.offering! : "";
  const settings = await getSettings();

  const offeringBlocks = all<ClassBlock>(
    `SELECT id, series_id, name, start_date, end_date, price_cents, weekdays, kind, description, summary, image_media_id, early_bird_price_cents, early_bird_until, daily_times_json, active, publication_status
     FROM class_blocks WHERE active = 1 AND publication_status = 'published' AND kind IN ('block','workshop','retreat') ORDER BY start_date ASC`
  );
  const offerings = await Promise.all(offeringBlocks.map(async (b) => {
    const view = await blockView(b);
    const ids = view.dates.map((d) => d.occurrenceId);
    const people = ids.length
      ? get<{ c: number }>(
          `SELECT COALESCE(SUM(seats), 0) AS c FROM (SELECT CASE WHEN ? IN ('workshop','retreat') THEN SUM(seat_count) ELSE 1 END AS seats
             FROM bookings WHERE status IN ('confirmed','attended') AND occurrence_id IN (${ids.map(() => "?").join(",")}) GROUP BY customer_id)`,
          view.kind, ...ids
        )!.c
      : 0;
    const dateLabel = b.start_date === b.end_date ? fmtDate(`${b.start_date}T12:00:00.000Z`, settings.timezone, true)
      : `${fmtDate(`${b.start_date}T12:00:00.000Z`, settings.timezone, true)} – ${fmtDate(`${b.end_date}T12:00:00.000Z`, settings.timezone, true)}`;
    return { view, ids, people, dateLabel, capacity: view.dates[0]?.capacity ?? 0 };
  }));
  const upcomingOfferings = offerings.filter((o) => !o.view.isPast);
  const pastOfferings = offerings.filter((o) => o.view.isPast).reverse();
  const selected = offeringId ? offerings.find((o) => String(o.view.id) === offeringId) ?? null : null;

  const roster = selected && selected.ids.length
    ? all<{ customer_id: number; name: string | null; email: string; phone: string | null; seats: number; dates: number; attendees: string | null }>(
        `SELECT c.id AS customer_id, c.name, c.email, c.phone, SUM(b.seat_count) AS seats, COUNT(*) AS dates,
           (SELECT group_concat(name, ', ') FROM booking_attendees WHERE booking_id = MIN(b.id)) AS attendees
         FROM bookings b JOIN customers c ON c.id = b.customer_id
         WHERE b.status IN ('confirmed','attended') AND b.occurrence_id IN (${selected.ids.map(() => "?").join(",")})
         GROUP BY c.id ORDER BY MIN(b.created_at) ASC`,
        ...selected.ids
      )
    : [];

  let where = "1=1";
  const params: unknown[] = [];
  if (offeringId) {
    where += selected && selected.ids.length ? ` AND b.occurrence_id IN (${selected.ids.map(() => "?").join(",")})` : " AND 1=0";
    if (selected) params.push(...selected.ids);
  }
  if (q) {
    where += " AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR o.ref LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (filter === "upcoming") where += " AND o2.starts_at >= datetime('now')";
  if (filter === "refunds") where += " AND p.status IN ('succeeded') AND b.status = 'cancelled'";

  const rows = all<{
    b_id: number; b_status: string; b_source: string; b_price: number; b_created: string; b_seat_count: number; attendee_names: string | null; attendee_lines: string | null; event_kind: string | null;
    c_id: number; c_name: string | null; c_email: string; c_phone: string | null;
    o_title: string; o_starts: string; occ_id: number;
    order_ref: string | null; pay_status: string | null; pay_provider: string | null; pay_id: number | null; pay_amount: number | null;
    transfer_id: number | null; transfer_refund_due: number | null;
  }>(
     `SELECT b.id AS b_id, b.status AS b_status, b.source AS b_source, b.price_cents AS b_price, b.created_at AS b_created, b.seat_count AS b_seat_count,
       (SELECT group_concat(name, ', ') FROM booking_attendees WHERE booking_id = b.id ORDER BY sort, id) AS attendee_names,
       (SELECT group_concat(name, char(10)) FROM (SELECT name FROM booking_attendees WHERE booking_id = b.id ORDER BY sort, id)) AS attendee_lines,
       event_block.kind AS event_kind,
       c.id AS c_id, c.name AS c_name, c.email AS c_email, c.phone AS c_phone,
       occ.title AS o_title, occ.starts_at AS o_starts, occ.id AS occ_id,
       ord.ref AS order_ref, p.status AS pay_status, p.provider AS pay_provider, p.id AS pay_id, p.amount_cents AS pay_amount,
       transfer.id AS transfer_id, transfer.refund_due_cents AS transfer_refund_due
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id
     JOIN class_occurrences occ ON occ.id = b.occurrence_id
     LEFT JOIN class_blocks event_block ON event_block.series_id = occ.series_id AND event_block.kind IN ('workshop','retreat')
     LEFT JOIN orders ord ON ord.id = b.order_id
     LEFT JOIN payments p ON p.order_id = ord.id AND p.status IN ('succeeded','refunded_part')
     LEFT JOIN event_transfers transfer ON transfer.id = (SELECT MAX(id) FROM event_transfers WHERE booking_id = b.id)
     WHERE ${where}
     ORDER BY occ.starts_at DESC, b.created_at DESC
     LIMIT ${offeringId ? 500 : 100}`,
    ...params
  );

  const upcomingForManual = all<{ id: number; title: string; starts_at: string }>(
    `SELECT o.id, o.title, o.starts_at FROM class_occurrences o LEFT JOIN class_series s ON s.id = o.series_id
     WHERE o.starts_at >= datetime('now') AND o.status = 'scheduled' AND o.publication_status = 'published'
       AND (o.series_id IS NULL OR (s.publication_status = 'published' AND s.status = 'active')) ORDER BY o.starts_at ASC LIMIT 40`
  );
  const [manualBlocks, manualBundles, upcomingEvents] = await Promise.all([listActiveBlockViews(), listActiveBundleViews(), listWorkshopViews()]);
  const manualEvents = upcomingEvents.filter((event) => event.onSale && event.remainingSeatsMin > 0);
  const pendingRefunds = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM bookings b JOIN payments p ON p.order_id = b.order_id
     WHERE b.status = 'cancelled' AND p.status = 'succeeded' AND p.provider = 'stripe'`
  )!;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Bookings</h1>
      {sp.added ? <Alert kind="success">{sp.event === "1" ? `Event booking added for ${sp.count} attendee${sp.count === "1" ? "" : "s"}.` : sp.count ? `Booking added for ${sp.count} class dates.` : "Booking added."}</Alert> : null}
      {sp.cancelled ? <Alert kind="success">Booking cancelled.</Alert> : null}
      {sp.refunded ? <Alert kind="success">Refund recorded.</Alert> : null}
      {sp.transferred ? <Alert kind="success">Event booking transferred.{sp.refundDue ? ` A refund of ${fmtEuro(Number(sp.refundDue))} remains to be settled below.` : ""}</Alert> : null}
      {sp.payment ? <Alert kind="success">Payment recorded.</Alert> : null}
      {pendingRefunds.c > 0 ? <Alert kind="info">{pendingRefunds.c} cancelled online booking(s) may need a refund - see rows marked “cancelled”.</Alert> : null}
      {sp.error ? <Alert kind="error">{sp.error}</Alert> : null}

      <Card className="p-6" id="by-offering">
        <h2 className="text-lg font-semibold text-forest-900">Who&apos;s booked in?</h2>
        <p className="mt-1 text-sm text-bark-500">Choose a block, workshop or retreat to see exactly who has booked and how many places are left.</p>
        {upcomingOfferings.length === 0 ? <p className="mt-4 text-sm text-bark-500">Nothing upcoming yet.</p> : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {upcomingOfferings.map((o) => (
              <li key={o.view.id}>
                <Link
                  href={selected?.view.id === o.view.id ? "/admin/bookings" : `/admin/bookings?offering=${o.view.id}`}
                  className={`block rounded-xl border px-4 py-3 hover:bg-sage-100 ${selected?.view.id === o.view.id ? "border-forest-800 bg-sage-100" : "border-oat-200"}`}
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-clay-700">{o.view.kind === "block" ? "Block" : o.view.kind === "retreat" ? "Retreat" : "Workshop"}</span>
                  <span className="block font-semibold text-forest-900">{o.view.name}</span>
                  <span className="block text-xs text-bark-500">{o.dateLabel}</span>
                  <span className="mt-1 block text-sm text-bark-700">
                    <strong>{o.people}</strong> booked · <strong>{o.view.remainingSeatsMin}</strong> of {o.capacity} places left
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pastOfferings.length > 0 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-forest-800 underline underline-offset-4">Finished ({pastOfferings.length})</summary>
            <ul className="mt-3 space-y-1 text-sm">
              {pastOfferings.map((o) => (
                <li key={o.view.id}>
                  <Link href={`/admin/bookings?offering=${o.view.id}`} className="underline underline-offset-4">{o.view.name}</Link>{" "}
                  <span className="text-bark-500">· {o.dateLabel} · {o.people} booked</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      {selected ? (
        <Card className="p-6" id="roster">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-forest-900">{selected.view.name}</h2>
              <p className="text-sm text-bark-500">{selected.dateLabel}</p>
            </div>
            <Link href="/admin/bookings" className="text-sm font-semibold text-forest-800 underline underline-offset-4">Show all bookings</Link>
          </div>
          <p className="mt-3 text-lg text-forest-900">
            <strong>{selected.people}</strong> booked · <strong>{selected.view.remainingSeatsMin}</strong> of {selected.capacity} places left
          </p>
          {roster.length === 0 ? <p className="mt-3 text-sm text-bark-500">Nobody has booked yet.</p> : (
            <ol className="mt-3 divide-y divide-oat-100 text-sm">
              {roster.map((p) => (
                <li key={p.customer_id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <Link href={`/admin/customers/${p.customer_id}`} className="font-semibold text-forest-900 underline underline-offset-4">{p.name ?? "(no name)"}</Link>
                    <span className="block text-xs text-bark-500">{p.email}{p.phone ? ` · ${p.phone}` : ""}</span>
                    {p.attendees ? <span className="block text-xs text-bark-500">Attending: {p.attendees}</span> : null}
                  </span>
                  <span className="text-xs text-bark-500">
                    {selected.view.kind === "block" ? `${p.dates} of ${selected.view.classCount} dates` : `${p.seats} place${p.seats === 1 ? "" : "s"}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : null}

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Search bookings</h2>
        <form className="mt-4 flex flex-wrap gap-3" method="get">
          {offeringId ? <input type="hidden" name="offering" value={offeringId} /> : null}
          <input name="q" defaultValue={q ?? ""} placeholder="Name, email, phone or order ref" className="min-w-0 flex-1 rounded-xl border border-oat-300 px-4 py-3" />
          <select name="filter" defaultValue={filter ?? ""} className="min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3">
            <option value="">All bookings</option>
            <option value="upcoming">Upcoming only</option>
            <option value="refunds">Cancelled with online payment</option>
          </select>
          <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white">Search</button>
        </form>
      </Card>

      {/* Results */}
      <Card className="overflow-hidden">
        <h2 className="px-6 pt-6 text-lg font-semibold text-forest-900">{rows.length} booking{rows.length === 1 ? "" : "s"}{selected ? ` for ${selected.view.name}` : ""}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-oat-100 bg-oat-50 text-left text-xs uppercase tracking-wider text-bark-500">
                <th className="px-6 py-3 font-semibold">Student</th>
                <th className="px-4 py-3 font-semibold">Class</th>
                <th className="px-4 py-3 font-semibold">Payment</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oat-100">
              {rows.map((r) => (
                <tr key={r.b_id} className={r.b_status === "cancelled" ? "opacity-60" : ""}>
                  <td className="px-6 py-3">
                    <Link href={`/admin/customers/${r.c_id}`} className="font-semibold text-forest-900 underline underline-offset-4">{r.c_name ?? "(no name)"}</Link>
                    <span className="block text-xs text-bark-500">{r.c_email}{r.c_phone ? ` · ${r.c_phone}` : ""}</span>
                    {r.b_seat_count > 1 ? <span className="block text-xs text-bark-500">{r.b_seat_count} places: {r.attendee_names}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    {r.o_title}
                    <span className="block text-xs text-bark-500">{fmtDate(r.o_starts, settings.timezone, true)} · <Link href={`/admin/classes/${r.occ_id}`} className="underline">class</Link></span>
                  </td>
                  <td className="px-4 py-3">
                    {r.pay_id ? (
                      <>
                        {fmtEuro(r.pay_amount ?? 0)} <span className="text-xs text-bark-500">({r.pay_provider})</span>
                        {r.pay_provider === "stripe" && r.b_status === "cancelled" ? (
                          <form action={refundPaymentAction} className="mt-1 flex items-center gap-1">
                            <input type="hidden" name="paymentId" value={r.pay_id} />
                            <input name="amount" placeholder={((r.pay_amount ?? 0) / 100).toFixed(2)} className="w-20 rounded-lg border border-oat-300 px-2 py-1 text-xs" />
                            <button type="submit" className="text-xs font-semibold text-clay-700 underline underline-offset-4">Refund</button>
                          </form>
                        ) : null}
                        {r.transfer_id && (r.transfer_refund_due ?? 0) > 0 ? (
                          <form action={refundPaymentAction} className="mt-2 flex items-center gap-1">
                            <input type="hidden" name="paymentId" value={r.pay_id} />
                            <input type="hidden" name="eventTransferId" value={r.transfer_id} />
                            <input type="hidden" name="reason" value="Price difference on event transfer" />
                            <input name="amount" aria-label="Transfer refund amount" defaultValue={((r.transfer_refund_due ?? 0) / 100).toFixed(2)} className="w-20 rounded-lg border border-oat-300 px-2 py-1 text-xs" />
                            <button type="submit" className="text-xs font-semibold text-clay-700 underline underline-offset-4">Refund difference</button>
                          </form>
                        ) : null}
                      </>
                    ) : r.b_price > 0 ? (
                      <span className="text-bark-500">{fmtEuro(r.b_price)} · {r.b_source}</span>
                    ) : (
                      <span className="text-bark-500">{r.b_source === "pass" ? "pass credit" : r.b_source === "membership" ? "membership" : "no charge"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.b_status === "cancelled" ? "bg-oat-100 text-bark-500" : r.b_status === "attended" ? "bg-forest-800 text-white" : "bg-sage-100 text-forest-800"}`}>
                      {r.b_status}
                    </span>
                    <span className="block text-xs text-bark-500">{r.order_ref ?? "manual"}</span>
                  </td>
                  <td className="px-6 py-3">
                    {r.b_status === "confirmed" ? (
                      <form action={cancelBookingAdminAction} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={r.b_id} />
                        <input type="hidden" name="notify" value="on" />
                        <input type="hidden" name="reason" value="Cancelled by Anne" />
                        <button type="submit" className="text-xs font-semibold text-clay-700 underline underline-offset-4">Cancel + notify</button>
                      </form>
                    ) : null}
                    {r.b_status === "cancelled" && r.event_kind && manualEvents.some((event) => event.kind === r.event_kind) ? (
                      <details className="mt-2 max-w-sm">
                        <summary className="cursor-pointer text-xs font-semibold text-forest-800 underline underline-offset-4">Transfer group to another {r.event_kind}</summary>
                        <form action={transferEventBookingAction} className="mt-3 grid gap-2 rounded-lg border border-oat-200 p-3">
                          <input type="hidden" name="bookingId" value={r.b_id} />
                          <label className="grid gap-1 text-xs font-semibold">Replacement event<select name="targetOccurrenceId" required defaultValue="" className="w-full min-w-0 max-w-full rounded-lg border border-oat-300 px-2 py-2 text-sm"><option value="" disabled>Choose a future event</option>{manualEvents.filter((event) => event.kind === r.event_kind).map((event) => { const target = event.dates[0]; return target ? <option key={event.id} value={target.occurrenceId}>{event.name} · {fmtDate(target.startsAt, settings.timezone, true)} · {fmtEuro(event.price_cents)} per person</option> : null; })}</select></label>
                          <label className="grid gap-1 text-xs font-semibold">Attendee names, one per line<textarea name="attendeeNames" required rows={Math.max(2, Math.min(5, r.b_seat_count))} defaultValue={r.attendee_lines ?? r.c_name ?? ""} className="rounded-lg border border-oat-300 px-2 py-2 text-sm font-normal" /></label>
                          <label className="grid gap-1 text-xs font-semibold">If an extra payment is due, record it as<select name="paymentMethod" defaultValue="transfer" className="w-full min-w-0 max-w-full rounded-lg border border-oat-300 px-2 py-2 text-sm"><option value="transfer">Bank transfer received</option><option value="cash">Cash received</option><option value="recorded">Already paid</option></select></label>
                          <label className="grid gap-1 text-xs font-semibold">Payment note<input name="note" className="rounded-lg border border-oat-300 px-2 py-2 text-sm font-normal" /></label>
                          <button type="submit" className="min-h-10 rounded-full bg-forest-800 px-4 text-xs font-semibold text-white">Transfer booking</button>
                        </form>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-6 py-6 text-center text-bark-500">No bookings match. Try a different search.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <h2 className="pt-4 text-2xl font-semibold text-forest-900" id="add">Add a booking</h2>
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <Card className="p-6" id="manual">
        <h2 className="text-lg font-semibold text-forest-900">Add a booking (phone / WhatsApp)</h2>
        <form action={adminBookingAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
            Class
            <select name="occurrenceId" required className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3">
              {upcomingForManual.map((o) => (
                <option key={o.id} value={o.id}>{fmtDate(o.starts_at, settings.timezone, true)} {fmtDateTime(o.starts_at, o.starts_at, settings.timezone).split("·")[1]} - {o.title}</option>
              ))}
            </select>
          </label>
          <Field label="Name" name="name" required />
          <Field label="Email" name="email" type="email" required />
          <Field label="Mobile" name="phone" type="tel" />
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
            Payment
            <select name="paymentMethod" className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3">
              <option value="cash">Pay at class (cash)</option>
              <option value="transfer">Bank transfer</option>
              <option value="complimentary">Complimentary</option>
              <option value="recorded">Paid in advance (I recorded it)</option>
            </select>
          </label>
          <Field label="Amount (€, optional)" name="amount" placeholder="12.00" />
          <Field label="Note (admin only)" name="note" className="sm:col-span-2" />
          <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white sm:col-span-2">Add booking</button>
        </form>
      </Card>
      </div>

      <Card className="p-6" id="manual-block">
        <h2 className="text-lg font-semibold text-forest-900">Add a whole block or bundle</h2>
        <p className="mt-1 text-sm text-bark-500">For someone who booked by phone or message. One entry reserves every date and records one offline payment.</p>
        {manualBlocks.length + manualBundles.length === 0 ? (
          <p className="mt-4 text-sm text-bark-500">No published blocks or bundles are currently on sale.</p>
        ) : (
          <form action={adminBlockBookingAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
              Block or bundle
              <select name="offering" required defaultValue="" className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3">
                <option value="" disabled>Choose an offering</option>
                {manualBlocks.map((block) => (
                  <option key={`block-${block.id}`} value={`block:${block.id}`}>Block: {block.name} · {fmtEuro(block.price_cents)}</option>
                ))}
                {manualBundles.map((bundle) => (
                  <option key={`bundle-${bundle.id}`} value={`bundle:${bundle.id}`}>Bundle: {bundle.name} · {fmtEuro(bundle.price_cents)}</option>
                ))}
              </select>
            </label>
            <Field label="Name" name="name" required />
            <Field label="Email" name="email" type="email" required />
            <Field label="Mobile" name="phone" type="tel" />
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
              Payment
              <select name="paymentMethod" className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3">
                <option value="cash">Pay at class (cash)</option>
                <option value="transfer">Bank transfer</option>
                <option value="complimentary">Complimentary</option>
                <option value="recorded">Paid in advance (I recorded it)</option>
              </select>
            </label>
            <Field label="Amount (€, optional)" name="amount" placeholder="Leave blank to use offering price" />
            <Field label="Note (admin only)" name="note" className="sm:col-span-2" />
            <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white sm:col-span-2">Add booking for all dates</button>
          </form>
        )}
      </Card>

      <Card className="p-6" id="manual-event">
        <h2 className="text-lg font-semibold text-forest-900">Add a Workshop or Retreat group</h2>
        <p className="mt-1 text-sm text-bark-500">Enter the payer&apos;s contact details and one name for each attendee. Capacity is reserved for everyone together.</p>
        {manualEvents.length === 0 ? (
          <p className="mt-4 text-sm text-bark-500">No published Workshops or Retreats currently have places available.</p>
        ) : (
          <form action={adminBlockBookingAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
              Workshop or Retreat
              <select name="offering" required defaultValue="" className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3">
                <option value="" disabled>Choose an event</option>
                {manualEvents.map((event) => (
                  <option key={event.id} value={`block:${event.id}`}>{event.kind === "retreat" ? "Retreat" : "Workshop"}: {event.name} · {fmtEuro(event.price_cents)} per person</option>
                ))}
              </select>
            </label>
            <Field label="Payer / contact name" name="name" required />
            <Field label="Payer email" name="email" type="email" required />
            <Field label="Payer mobile" name="phone" type="tel" />
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
              Attendee names (one per line)
              <textarea name="attendeeNames" rows={4} required placeholder={"First attendee\nSecond attendee"} className="rounded-xl border border-oat-300 px-4 py-3 text-base font-normal" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
              Payment
              <select name="paymentMethod" className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3">
                <option value="cash">Pay at event (cash)</option>
                <option value="transfer">Bank transfer</option>
                <option value="complimentary">Complimentary</option>
                <option value="recorded">Paid in advance (I recorded it)</option>
              </select>
            </label>
            <Field label="Amount (€, optional)" name="amount" placeholder="Leave blank for full event total" />
            <Field label="Note (admin only)" name="note" className="sm:col-span-2" />
            <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white sm:col-span-2">Add event booking</button>
          </form>
        )}
      </Card>
    </div>
  );
}
