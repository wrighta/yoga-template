import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get } from "@/db";
import { Card, Alert, Field, ButtonLink } from "@/components/ui";
import { fmtDateTime, fmtDate } from "@/lib/tz";
import { getSettings } from "@/lib/settings";
import { fmtEuro } from "@/lib/money";
import { updateOccurrenceAction, cancelOccurrenceAction, notifyOccurrenceAction, markAttendanceAction, recordOfflinePaymentAction, cancelBookingAdminAction } from "@/app/admin/actions";
import { duplicateOccurrenceAction } from "@/app/admin/actions-setup";
import { CopyPhoneButton } from "@/components/copy-phone-button";

export default async function AdminClassDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; notified?: string }>;
}) {
  const { id } = await params;
  const { saved, error, notified } = await searchParams;
  const occ = get<{
    id: number; title: string; starts_at: string; ends_at: string; capacity: number; status: string; publication_status: "draft" | "published"; series_publication_status: "draft" | "published" | null;
    price_override_cents: number | null; waitlist_enabled: number; notes_public: string | null; notes_admin: string | null; class_type_id: number; venue_id: number | null; series_id: number | null;
  }>(`SELECT o.*, s.publication_status AS series_publication_status FROM class_occurrences o LEFT JOIN class_series s ON s.id = o.series_id WHERE o.id = ?`, Number(id));
  if (!occ) notFound();
  const settings = await getSettings();

  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(occ.starts_at));
  const localStart = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(occ.starts_at));
  const localEnd = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(occ.ends_at));

  const bookings = all<{
    id: number; status: string; source: string; price_cents: number; order_id: number | null; seat_count: number; attendee_names: string | null;
    c_id: number; c_name: string | null; c_email: string; c_phone: string | null;
  }>(
    `SELECT b.id, b.status, b.source, b.price_cents, b.order_id, b.seat_count,
       (SELECT group_concat(name, ', ') FROM booking_attendees WHERE booking_id = b.id ORDER BY sort, id) AS attendee_names,
       c.id AS c_id, c.name AS c_name, c.email AS c_email, c.phone AS c_phone
     FROM bookings b JOIN customers c ON c.id = b.customer_id
     WHERE b.occurrence_id = ? AND b.status IN ('confirmed','attended')
     ORDER BY c.name COLLATE NOCASE`,
    occ.id
  );
  const waitlist = all<{ id: number; c_name: string | null; c_email: string; status: string; position: number; offered_at: string | null }>(
    `SELECT w.id, c.name AS c_name, c.email AS c_email, w.status, w.position, w.offered_at
     FROM waitlist_entries w JOIN customers c ON c.id = w.customer_id
     WHERE w.occurrence_id = ? AND w.status IN ('waiting','offered')
     ORDER BY w.position ASC`,
    occ.id
  );
  const confirmed = bookings.filter((b) => b.status === "confirmed").reduce((total, booking) => total + booking.seat_count, 0);
  const remaining = Math.max(0, occ.capacity - confirmed);
  void remaining;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/classes" className="text-sm font-semibold text-forest-800 underline underline-offset-4">← Schedule</Link>
        <h1 className="mt-2 text-3xl font-semibold text-forest-900">{occ.title}</h1>
        <p className="mt-1 text-bark-500">{fmtDateTime(occ.starts_at, occ.ends_at, settings.timezone)} · {occ.status === "cancelled" ? "CANCELLED" : `${confirmed}/${occ.capacity} places booked`} · {occ.series_id ? `Series ${occ.series_publication_status}` : occ.publication_status}</p>
      </div>
      {saved ? <Alert kind="success">Saved.</Alert> : null}
      {notified ? <Alert kind="success">Message sent to {notified} attendees.</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Edit */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">Edit this class</h2>
          <p className="mt-1 text-sm text-bark-500">Changes affect this date only - the rest of the series keeps its own settings.</p>
          <form action={updateOccurrenceAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={occ.id} />
            <Field label="Title" name="title" defaultValue={occ.title} required className="sm:col-span-2" />
            <Field label="Date" name="date" type="date" defaultValue={localDate} required />
            <Field label="Capacity" name="capacity" type="number" defaultValue={String(occ.capacity)} required />
            <Field label="Start" name="startTime" type="time" defaultValue={localStart} required />
            <Field label="End" name="endTime" type="time" defaultValue={localEnd} required />
            <Field label="Price override (€, blank = standard)" name="priceOverride" defaultValue={occ.price_override_cents != null ? (occ.price_override_cents / 100).toFixed(2) : ""} />
            {occ.series_id ? (
              <p className="self-center text-sm text-bark-500">Visibility is controlled by this class&apos;s recurring series.</p>
            ) : (
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
                Visibility
                <select name="publicationStatus" defaultValue={occ.publication_status} className="rounded-xl border border-oat-300 px-4 py-3">
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </label>
            )}
            <label className="flex items-center gap-3 self-end text-sm font-medium text-bark-700 sm:col-span-1">
              <input type="checkbox" name="waitlist" defaultChecked={!!occ.waitlist_enabled} className="h-5 w-5 rounded accent-forest-800" />
              Waitlist enabled
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
              Public note (students see this)
              <textarea name="notesPublic" rows={2} defaultValue={occ.notes_public ?? ""} className="rounded-xl border border-oat-300 px-4 py-3" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
              Private note (only staff see this)
              <textarea name="notesAdmin" rows={2} defaultValue={occ.notes_admin ?? ""} className="rounded-xl border border-oat-300 bg-oat-50 px-4 py-3" />
            </label>
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900">Save changes</button>
              <ButtonLink href={`/classes/${occ.id}`} variant="secondary" className="!min-h-[48px]">View public page</ButtonLink>
              <a href={`/admin/bookings/register/${occ.id}`} target="_blank" className="inline-flex min-h-[48px] items-center rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800">Print register</a>
            </div>
          </form>
          <form action={duplicateOccurrenceAction} className="mt-4">
            <input type="hidden" name="id" value={occ.id} />
            <button type="submit" className="text-sm font-semibold text-forest-800 underline underline-offset-4">
              Duplicate this class to the same time next week (DST-safe)
            </button>
          </form>
          {occ.status !== "cancelled" && (
            <form action={cancelOccurrenceAction} className="mt-6 border-t border-oat-100 pt-4">
              <input type="hidden" name="id" value={occ.id} />
              <button type="submit" className="text-sm font-semibold text-clay-700 underline underline-offset-4">
                Cancel this class (emails all {bookings.length} attendees)
              </button>
            </form>
          )}
        </Card>

        {/* Notify */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">Message attendees</h2>
          <p className="mt-1 text-sm text-bark-500">Send an update to everyone booked into this class.</p>
          <form action={notifyOccurrenceAction} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="id" value={occ.id} />
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
              Message
              <textarea name="message" rows={4} required placeholder="e.g. Parking is limited tonight - allow a few extra minutes." className="rounded-xl border border-oat-300 px-4 py-3" />
            </label>
            <button type="submit" className="min-h-[44px] self-start rounded-full bg-forest-800 px-6 py-2.5 font-semibold text-white hover:bg-forest-900">
              Send to {bookings.length} attendees
            </button>
          </form>
        </Card>
      </div>

      {/* Attendance */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6">
          <h2 className="text-lg font-semibold text-forest-900">Class register</h2>
          <div className="flex items-center gap-4">
            <CopyPhoneButton phones={bookings.map((b) => b.c_phone ?? "")} />
            <a href={`/api/admin/export?type=bookings&occurrence=${occ.id}`} className="text-sm font-semibold text-forest-800 underline underline-offset-4">Export CSV</a>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-oat-100 bg-oat-50 text-left text-xs uppercase tracking-wider text-bark-500">
                <th className="px-6 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Paid</th>
                <th className="px-4 py-3 font-semibold">Mark</th>
                <th className="px-6 py-3 font-semibold">Cancel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oat-100">
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className="px-6 py-3">
                    <Link href={`/admin/customers/${b.c_id}`} className="font-semibold text-forest-900 underline underline-offset-4">{b.c_name ?? "(no name)"}</Link>
                    <span className="ml-2 rounded-full bg-sage-100 px-2 py-0.5 text-xs text-forest-800">{b.source}</span>
                    {b.seat_count > 1 ? <span className="ml-2 text-xs text-bark-500">{b.seat_count} places: {b.attendee_names}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-bark-500">
                    {b.c_email}
                    {b.c_phone ? <span className="block text-xs">{b.c_phone}</span> : null}
                  </td>
                  <td className="px-4 py-3">{b.price_cents > 0 ? fmtEuro(b.price_cents) : b.source === "pass" ? "credit" : b.source === "membership" ? "member" : "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <form action={markAttendanceAction}>
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="occurrenceId" value={occ.id} />
                        <input type="hidden" name="status" value="attended" />
                        <button type="submit" className={`rounded-full px-3 py-1.5 text-xs font-semibold ${b.status === "attended" ? "bg-forest-800 text-white" : "border border-forest-800/30 text-forest-800"}`}>Attended</button>
                      </form>
                      <form action={markAttendanceAction}>
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="occurrenceId" value={occ.id} />
                        <input type="hidden" name="status" value="no_show" />
                        <button type="submit" className="rounded-full border border-oat-300 px-3 py-1.5 text-xs font-semibold text-bark-500">No-show</button>
                      </form>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <form action={cancelBookingAdminAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={b.id} />
                      <input type="hidden" name="reason" value="Cancelled by Anne" />
                      <input type="hidden" name="notify" value="on" />
                      <button type="submit" className="text-xs font-semibold text-clay-700 underline underline-offset-4">Cancel + notify</button>
                    </form>
                  </td>
                </tr>
              ))}
              {bookings.length === 0 && <tr><td colSpan={5} className="px-6 py-6 text-center text-bark-500">No bookings for this class yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Record offline payment + waitlist */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">Record an offline payment</h2>
          <p className="mt-1 text-sm text-bark-500">For someone who paid cash, by transfer, or attends free.</p>
          <form action={recordOfflinePaymentAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
              Attendee
              <select name="bookingId" className="rounded-xl border border-oat-300 px-4 py-3">
                {bookings.map((b) => (
                  <option key={b.id} value={b.id}>{b.c_name ?? b.c_email}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
              Method
              <select name="method" className="rounded-xl border border-oat-300 px-4 py-3">
                <option value="cash">Cash</option>
                <option value="transfer">Bank transfer</option>
                <option value="complimentary">Complimentary</option>
              </select>
            </label>
            <Field label="Amount (€)" name="amount" placeholder="12.00" />
            <Field label="Note" name="note" className="sm:col-span-2" />
            <button type="submit" className="min-h-[44px] rounded-full bg-forest-800 px-6 py-2.5 font-semibold text-white sm:col-span-2">Record payment</button>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">Waitlist ({waitlist.length})</h2>
          <ul className="mt-4 divide-y divide-oat-100">
            {waitlist.map((w) => (
              <li key={w.id} className="flex items-center justify-between py-3 text-sm">
                <span>
                  <span className="font-semibold text-forest-900">{w.c_name ?? w.c_email}</span>
                  <span className="block text-xs text-bark-500">#{w.position} · {w.status === "offered" ? `offer sent ${w.offered_at ? fmtDate(w.offered_at, settings.timezone) : ""}` : "waiting"}</span>
                </span>
                <span className="text-bark-500">{w.c_email}</span>
              </li>
            ))}
            {waitlist.length === 0 && <li className="py-3 text-sm text-bark-500">Nobody waiting.</li>}
          </ul>
          <p className="mt-3 text-xs text-bark-500">
            When a booking is cancelled, the next person is offered the place automatically (with an expiry). Cancelling a class clears this.
          </p>
        </Card>
      </div>
    </div>
  );
}
