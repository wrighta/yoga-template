import Link from "next/link";
import { all } from "@/db";
import { Card, Alert } from "@/components/ui";
import { fmtDate } from "@/lib/tz";
import { getSettings } from "@/lib/settings";
import { requireBusinessAdminPage } from "@/lib/auth";

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pass?: string; anonymised?: string; error?: string }>;
}) {
  await requireBusinessAdminPage();
  const { q, pass, anonymised, error } = await searchParams;
  const settings = await getSettings();
  let where = "1=1";
  const params: unknown[] = [];
  if (q) {
    where = "(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const customers = all<{
    id: number; name: string | null; email: string; phone: string | null; marketing_consent: number; anonymised: number; created_at: string;
    bookings: number; upcoming: number; passes: number; member: number;
  }>(
    `SELECT c.id, c.name, c.email, c.phone, c.marketing_consent, c.anonymised, c.created_at,
       (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id AND b.status IN ('confirmed','attended')) AS bookings,
       (SELECT COUNT(*) FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id WHERE b.customer_id = c.id AND b.status = 'confirmed' AND o.starts_at >= datetime('now')) AS upcoming,
       (SELECT COUNT(*) FROM passes p WHERE p.customer_id = c.id AND p.status = 'active' AND p.expires_at > datetime('now')) AS passes,
       (SELECT COUNT(*) FROM memberships m WHERE m.customer_id = c.id AND m.status = 'active' AND m.current_period_end >= datetime('now')) AS member
     FROM customers c
     WHERE ${where}
     ORDER BY c.created_at DESC LIMIT 100`,
    ...params
  );
  const newsletterCount = all<{ c: number }>(`SELECT COUNT(*) AS c FROM customers WHERE marketing_consent = 1`)[0];

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Customers</h1>
      {pass ? <Alert kind="success">Pass credit adjusted.</Alert> : null}
      {anonymised ? <Alert kind="success">Customer anonymised - their personal details are gone, booking history totals remain for accounts.</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      <Alert kind="info">
        {newsletterCount.c} customer{newsletterCount.c === 1 ? "" : "s"} opted in to marketing emails.{" "}
        <a href="/api/admin/export?type=newsletter" className="font-semibold underline underline-offset-4">Export list (CSV)</a>
      </Alert>

      <Card className="p-6">
        <form className="flex gap-3" method="get">
          <input name="q" defaultValue={q ?? ""} placeholder="Search by name, email or phone" className="min-w-0 flex-1 rounded-xl border border-oat-300 px-4 py-3" />
          <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white">Search</button>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="mt-6 overflow-x-auto px-6 pb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-oat-100 bg-oat-50 text-left text-xs uppercase tracking-wider text-bark-500">
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Bookings</th>
                <th className="px-4 py-3 font-semibold">Passes</th>
                <th className="px-4 py-3 font-semibold">Member</th>
                <th className="px-4 py-3 font-semibold">Marketing</th>
                <th className="px-4 py-3 font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oat-100">
              {customers.map((c) => (
                <tr key={c.id} className={c.anonymised ? "opacity-50" : ""}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${c.id}`} className="font-semibold text-forest-900 underline underline-offset-4">
                      {c.name ?? "(no name)"}
                    </Link>
                    <span className="block text-xs text-bark-500">{c.email}{c.phone ? ` · ${c.phone}` : ""}{c.anonymised ? " · anonymised" : ""}</span>
                  </td>
                  <td className="px-4 py-3">{c.bookings} <span className="text-xs text-bark-500">({c.upcoming} upcoming)</span></td>
                  <td className="px-4 py-3">{c.passes > 0 ? `${c.passes} active` : "-"}</td>
                  <td className="px-4 py-3">{c.member > 0 ? "Yes" : "-"}</td>
                  <td className="px-4 py-3">{c.marketing_consent ? "Opted in" : "No"}</td>
                  <td className="px-4 py-3 text-bark-500">{fmtDate(c.created_at, settings.timezone, true)}</td>
                </tr>
              ))}
              {customers.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-bark-500">No customers found.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
