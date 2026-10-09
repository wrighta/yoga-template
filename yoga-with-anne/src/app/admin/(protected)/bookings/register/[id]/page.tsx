import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get } from "@/db";
import { fmtDateTime, fmtDate } from "@/lib/tz";
import { getSettings } from "@/lib/settings";

export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const occ = get<{ title: string; starts_at: string; ends_at: string; capacity: number }>(
    `SELECT title, starts_at, ends_at, capacity FROM class_occurrences WHERE id = ?`,
    Number(id)
  );
  if (!occ) notFound();
  const settings = await getSettings();
  const rows = all<{ name: string | null; phone: string | null; email: string; status: string; source: string; price_cents: number; seat_count: number; attendee_names: string | null }>(
    `SELECT c.name, c.phone, c.email, b.status, b.source, b.price_cents, b.seat_count,
       (SELECT group_concat(name, ', ') FROM booking_attendees WHERE booking_id = b.id ORDER BY sort, id) AS attendee_names
     FROM bookings b JOIN customers c ON c.id = b.customer_id
     WHERE b.occurrence_id = ? AND b.status IN ('confirmed','attended')
     ORDER BY c.name COLLATE NOCASE`,
    Number(id)
  );
  const expectedPlaces = rows.reduce((total, row) => total + row.seat_count, 0);
  const classType = get<{ what_to_bring: string | null }>(
    `SELECT ct.what_to_bring FROM class_occurrences o JOIN class_types ct ON ct.id = o.class_type_id WHERE o.id = ?`,
    Number(id)
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between no-print">
        <Link href={`/admin/classes/${id}`} className="text-sm font-semibold text-forest-800 underline underline-offset-4">← Back to class</Link>
        <p className="text-xs text-bark-500">Use your browser&apos;s print function (⌘P) for a paper copy.</p>
      </div>
      <div className="mt-6 rounded-[var(--radius-card)] border border-oat-200 bg-white p-8 print:border-0">
        <h1 className="font-display text-2xl font-semibold text-forest-900">Class register</h1>
        <p className="mt-1 text-bark-700">
          {occ.title} - {fmtDateTime(occ.starts_at, occ.ends_at, settings.timezone)}
        </p>
        <p className="mt-1 text-sm text-bark-500">
          {expectedPlaces}/{occ.capacity} places expected · printed {fmtDate(new Date().toISOString(), settings.timezone, true)}
        </p>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-forest-900 text-left">
              <th className="py-2 pr-3 font-semibold">#</th>
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="py-2 pr-3 font-semibold">Phone</th>
              <th className="py-2 pr-3 font-semibold">Paid</th>
              <th className="py-2 font-semibold">Present</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-oat-100">
                <td className="py-2 pr-3 text-bark-500">{i + 1}</td>
                <td className="py-2 pr-3 font-medium">{r.seat_count > 1 ? r.attendee_names : r.name ?? r.email}</td>
                <td className="py-2 pr-3">{r.phone ?? "-"}</td>
                <td className="py-2 pr-3">{r.price_cents > 0 ? `€${(r.price_cents / 100).toFixed(2)}` : r.source === "pass" ? "credit" : r.source === "membership" ? "member" : "-"}</td>
                <td className="py-2 w-10"><span className="inline-block h-4 w-4 border border-bark-300" /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="py-4 text-bark-500">No bookings yet.</td></tr>}
          </tbody>
        </table>

        {classType?.what_to_bring ? (
          <p className="mt-6 text-xs text-bark-500">What to bring: {classType.what_to_bring}</p>
        ) : null}
        <p className="mt-2 text-xs text-bark-500">
          Privacy note: this register contains only what is needed to run the class. Please keep it secure and dispose of paper copies safely.
        </p>
      </div>
    </div>
  );
}
