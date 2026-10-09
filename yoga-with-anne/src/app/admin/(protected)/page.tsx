import Link from "next/link";
import { all, get, nowIso } from "@/db";
import { Card, Alert } from "@/components/ui";
import { fmtDateTime, fmtDate } from "@/lib/tz";
import { fmtEuro } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { runJobsAction } from "@/app/admin/actions";

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ jobs?: string }> }) {
  const { jobs } = await searchParams;
  const settings = await getSettings();
  const now = nowIso();

  const nextClasses = all<{
    id: number; title: string; starts_at: string; ends_at: string; capacity: number;
    booked: number; held: number; waitlist: number;
  }>(
    `SELECT o.id, o.title, o.starts_at, o.ends_at, o.capacity,
      (SELECT COALESCE(SUM(b.seat_count),0) FROM bookings b WHERE b.occurrence_id = o.id AND b.status IN ('confirmed','attended')) AS booked,
       (SELECT COALESCE(SUM(h.qty),0) FROM capacity_holds h WHERE h.occurrence_id = o.id AND h.released = 0 AND h.expires_at > ?) AS held,
       (SELECT COUNT(*) FROM waitlist_entries w WHERE w.occurrence_id = o.id AND w.status = 'waiting') AS waitlist
     FROM class_occurrences o LEFT JOIN class_series s ON s.id = o.series_id
     WHERE o.starts_at >= ? AND o.status = 'scheduled' AND o.publication_status = 'published'
       AND (o.series_id IS NULL OR (s.publication_status = 'published' AND s.status = 'active'))
     ORDER BY o.starts_at ASC LIMIT 4`,
    now, now
  );

  const recentBookings = all<{
    b_id: number; o_title: string; o_starts: string; c_name: string | null; c_email: string; status: string; source: string; created: string;
  }>(
    `SELECT b.id AS b_id, o.title AS o_title, o.starts_at AS o_starts, c.name AS c_name, c.email AS c_email, b.status, b.source, b.created_at AS created
     FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id JOIN customers c ON c.id = b.customer_id
     ORDER BY b.created_at DESC LIMIT 8`
  );

  const pendingHolds = all<{ ref: string; total_cents: number; expires_at: string }>(
    `SELECT ref, total_cents, expires_at FROM orders WHERE status = 'awaiting_payment' AND expires_at > ? ORDER BY expires_at ASC LIMIT 5`,
    now
  );

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const revenue = get<{ online: number; offline: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN p.provider = 'stripe' THEN p.amount_cents ELSE 0 END), 0) AS online,
       COALESCE(SUM(CASE WHEN p.provider != 'stripe' THEN p.amount_cents ELSE 0 END), 0) AS offline
     FROM payments p JOIN orders o ON o.id = p.order_id
     WHERE p.status = 'succeeded' AND o.paid_at >= ?`,
    monthStart.toISOString()
  )!;
  const activeMemberships = get<{ c: number }>(`SELECT COUNT(*) AS c FROM memberships WHERE status = 'active' AND current_period_end >= ?`, now)!;
  const expiringPasses = all<{ c_email: string; c_name: string | null; credits_left: number; expires_at: string; product_name: string }>(
    `SELECT c.email AS c_email, c.name AS c_name, p.expires_at, pr.name AS product_name,
       p.credits_total - (SELECT COALESCE(SUM(-l.delta),0) FROM pass_credit_ledger l WHERE l.pass_id = p.id AND l.delta < 0) + (SELECT COALESCE(SUM(l.delta),0) FROM pass_credit_ledger l WHERE l.pass_id = p.id AND l.delta > 0) AS credits_left
     FROM passes p JOIN customers c ON c.id = p.customer_id JOIN products pr ON pr.id = p.product_id
     WHERE p.status = 'active' AND p.expires_at > ? AND p.expires_at < ?
     ORDER BY p.expires_at ASC LIMIT 5`,
    now, new Date(Date.now() + 14 * 86400_000).toISOString()
  );

  const upcoming = nextClasses[0];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-forest-900">Dashboard</h1>
        <form action={runJobsAction}>
          <button type="submit" className="inline-flex min-h-[44px] items-center rounded-full border-2 border-forest-800 px-5 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100">
            Run reminders &amp; jobs now
          </button>
        </form>
      </div>
      {jobs ? <Alert kind="success">Jobs ran - reminders sent: {jobs.split(":")[1] ?? "0"}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-bark-500">Next class</p>
          {upcoming ? (
            <>
              <p className="mt-2 font-display text-lg font-semibold text-forest-900">{fmtDateTime(upcoming.starts_at, upcoming.ends_at, settings.timezone)}</p>
              <p className="mt-1 text-sm text-bark-500">
                {upcoming.booked}/{upcoming.capacity} booked{upcoming.waitlist > 0 ? ` · ${upcoming.waitlist} waitlisted` : ""}
              </p>
              <Link href={`/admin/classes/${upcoming.id}`} className="mt-2 inline-block text-sm font-semibold text-forest-800 underline underline-offset-4">Manage class →</Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-bark-500">No upcoming classes - create some in <Link href="/admin/classes" className="underline">Schedule</Link>.</p>
          )}
        </Card>
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-bark-500">Revenue this month</p>
          <p className="mt-2 font-display text-2xl font-semibold text-forest-900">{fmtEuro(revenue.online + revenue.offline)}</p>
          <p className="mt-1 text-xs text-bark-500">
            Online {fmtEuro(revenue.online)} · in-person {fmtEuro(revenue.offline)} (paid)
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-bark-500">Active memberships</p>
          <p className="mt-2 font-display text-2xl font-semibold text-forest-900">{activeMemberships.c}</p>
          <p className="mt-1 text-xs text-bark-500">Renewals run through Stripe Billing or manual records</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-bark-500">Checkouts in progress</p>
          <p className="mt-2 font-display text-2xl font-semibold text-forest-900">{pendingHolds.length}</p>
          <ul className="mt-1 space-y-0.5 text-xs text-bark-500">
            {pendingHolds.map((h) => (
              <li key={h.ref}>{h.ref} · {fmtEuro(h.total_cents)} · holds until {new Date(h.expires_at).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}</li>
            ))}
            {pendingHolds.length === 0 && <li>None right now</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-forest-900">Upcoming classes</h2>
            <Link href="/admin/classes" className="text-sm font-semibold text-forest-800 underline underline-offset-4">All →</Link>
          </div>
          <ul className="mt-4 divide-y divide-oat-100">
            {nextClasses.map((c) => {
              const remaining = Math.max(0, c.capacity - c.booked - c.held);
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold text-forest-900">{fmtDate(c.starts_at, settings.timezone)}</p>
                    <p className="text-sm text-bark-500">{fmtDateTime(c.starts_at, c.ends_at, settings.timezone).split("·")[1]}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className={remaining === 0 ? "font-semibold text-clay-700" : remaining <= 3 ? "font-semibold text-gold-700" : "font-semibold text-forest-800"}>
                      {c.booked}/{c.capacity} booked
                    </p>
                    {c.waitlist > 0 && <p className="text-xs text-clay-700">{c.waitlist} on waitlist</p>}
                    <Link href={`/admin/classes/${c.id}`} className="text-xs font-semibold text-forest-800 underline underline-offset-4">Register →</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-forest-900">Recent bookings</h2>
            <Link href="/admin/bookings" className="text-sm font-semibold text-forest-800 underline underline-offset-4">All →</Link>
          </div>
          <ul className="mt-4 divide-y divide-oat-100">
            {recentBookings.map((b) => (
              <li key={b.b_id} className="py-2.5 text-sm">
                <p className="font-semibold text-forest-900">{b.c_name ?? b.c_email} <span className="font-normal text-bark-500">· {b.o_title}</span></p>
                <p className="text-xs text-bark-500">
                  {fmtDate(b.o_starts, settings.timezone)} · {b.source} · {b.status}
                </p>
              </li>
            ))}
            {recentBookings.length === 0 && <li className="py-3 text-sm text-bark-500">No bookings yet - they&apos;ll appear here.</li>}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">Passes expiring in the next 2 weeks</h2>
          <ul className="mt-4 divide-y divide-oat-100">
            {expiringPasses.map((p, i) => (
              <li key={i} className="flex items-center justify-between py-2.5 text-sm">
                <span>{p.c_name ?? p.c_email}</span>
                <span className="text-bark-500">{p.credits_left} credits · expires {fmtDate(p.expires_at, settings.timezone)}</span>
              </li>
            ))}
            {expiringPasses.length === 0 && <li className="py-3 text-sm text-bark-500">Nothing expiring soon.</li>}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">Quick actions</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/admin/classes/new#series" className="inline-flex min-h-[44px] items-center rounded-full bg-forest-800 px-5 py-2 text-sm font-semibold text-white">Create a block or series</Link>
            <Link href="/admin/bookings#manual" className="inline-flex min-h-[44px] items-center rounded-full border-2 border-forest-800 px-5 py-2 text-sm font-semibold text-forest-800">Add a WhatsApp booking</Link>
            <Link href="/admin/content" className="inline-flex min-h-[44px] items-center rounded-full border-2 border-forest-800 px-5 py-2 text-sm font-semibold text-forest-800">Edit homepage</Link>
            <Link href="/admin/messages" className="inline-flex min-h-[44px] items-center rounded-full border-2 border-forest-800 px-5 py-2 text-sm font-semibold text-forest-800">Check emails</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
