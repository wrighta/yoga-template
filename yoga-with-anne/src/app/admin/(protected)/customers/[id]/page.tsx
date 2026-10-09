import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get } from "@/db";
import { Card, Alert, Field } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/tz";
import { fmtEuro } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { anonymiseCustomerAction, adjustPassCreditAction } from "@/app/admin/actions";
import { requireBusinessAdminPage } from "@/lib/auth";

export default async function AdminCustomerDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireBusinessAdminPage();
  const { id } = await params;
  const { error } = await searchParams;
  const customer = get<{ id: number; name: string | null; email: string; phone: string | null; marketing_consent: number; consent_at: string | null; anonymised: number; notes_admin: string | null; created_at: string }>(
    `SELECT * FROM customers WHERE id = ?`,
    Number(id)
  );
  if (!customer) notFound();
  const settings = await getSettings();

  const bookings = all<{ id: number; status: string; title: string; starts_at: string; price_cents: number; seat_count: number; attendee_names: string | null }>(
    `SELECT b.id, b.status, o.title, o.starts_at, b.price_cents, b.seat_count,
       (SELECT group_concat(name, ', ') FROM booking_attendees WHERE booking_id = b.id ORDER BY sort, id) AS attendee_names
     FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id
     WHERE b.customer_id = ? ORDER BY o.starts_at DESC LIMIT 30`,
    customer.id
  );
  const passes = all<{ id: number; product_name: string; credits_total: number; credits_left: number; expires_at: string; status: string }>(
    `SELECT p.id, pr.name AS product_name, p.credits_total, p.expires_at, p.status,
       p.credits_total - (SELECT COALESCE(SUM(-l.delta),0) FROM pass_credit_ledger l WHERE l.pass_id = p.id AND l.delta < 0) + (SELECT COALESCE(SUM(l.delta),0) FROM pass_credit_ledger l WHERE l.pass_id = p.id AND l.delta > 0) AS credits_left
     FROM passes p JOIN products pr ON pr.id = p.product_id
     WHERE p.customer_id = ? ORDER BY p.created_at DESC`,
    customer.id
  );
  const memberships = all<{ id: number; product_name: string; status: string; current_period_end: string | null; cancel_at_period_end: number }>(
    `SELECT m.id, pr.name AS product_name, m.status, m.current_period_end, m.cancel_at_period_end
     FROM memberships m JOIN products pr ON pr.id = m.product_id
     WHERE m.customer_id = ? ORDER BY m.created_at DESC`,
    customer.id
  );
  const orders = all<{ ref: string; status: string; total_cents: number; created_at: string }>(
    `SELECT ref, status, total_cents, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 15`,
    customer.id
  );

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/customers" className="text-sm font-semibold text-forest-800 underline underline-offset-4">← Customers</Link>
        <h1 className="mt-2 text-3xl font-semibold text-forest-900">{customer.name ?? "(no name)"}</h1>
        <p className="text-bark-500">{customer.email}{customer.phone ? ` · ${customer.phone}` : ""} · joined {fmtDate(customer.created_at, settings.timezone, true)}</p>
        {customer.anonymised ? <div className="mt-2"><Alert>This customer has been anonymised - personal details are removed.</Alert></div> : null}
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">Passes &amp; membership</h2>
          <ul className="mt-4 space-y-3">
            {passes.map((p) => (
              <li key={p.id} className="rounded-xl border border-oat-200 p-4">
                <p className="font-semibold text-forest-900">{p.product_name}</p>
                <p className="text-sm text-bark-500">{p.credits_left} of {p.credits_total} credits · expires {fmtDate(p.expires_at, settings.timezone, true)} · {p.status}</p>
                <form action={adjustPassCreditAction} className="mt-2 flex items-center gap-2">
                  <input type="hidden" name="passId" value={p.id} />
                  <select name="delta" className="rounded-lg border border-oat-300 px-2 py-1.5 text-xs">
                    <option value="1">+1 credit</option>
                    <option value="-1">−1 credit</option>
                    <option value="2">+2 credits</option>
                    <option value="-2">−2 credits</option>
                  </select>
                  <input name="reason" required placeholder="Reason (required)" className="min-w-0 flex-1 rounded-lg border border-oat-300 px-2 py-1.5 text-xs" />
                  <button type="submit" className="rounded-lg border border-forest-800 px-3 py-1.5 text-xs font-semibold text-forest-800">Apply</button>
                </form>
              </li>
            ))}
            {passes.length === 0 && <li className="text-sm text-bark-500">No passes.</li>}
            {memberships.map((m) => (
              <li key={`m${m.id}`} className="rounded-xl border border-oat-200 p-4">
                <p className="font-semibold text-forest-900">{m.product_name}</p>
                <p className="text-sm text-bark-500">
                  {m.status} · renews {m.current_period_end ? fmtDate(m.current_period_end, settings.timezone, true) : "-"}
                  {m.cancel_at_period_end ? " · cancels at period end" : ""}
                </p>
              </li>
            ))}
            {memberships.length === 0 && passes.length === 0 && null}
            {!passes.length && !memberships.length && <li className="text-sm text-bark-500">No passes or membership.</li>}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">Bookings</h2>
          <ul className="mt-4 divide-y divide-oat-100">
            {bookings.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2.5 text-sm">
                <span>
                  <span className="font-semibold text-forest-900">{b.title}</span>
                  <span className="block text-xs text-bark-500">{fmtDateTime(b.starts_at, b.starts_at, settings.timezone)}</span>
                  {b.attendee_names ? <span className="block text-xs text-bark-500">Attendees: {b.attendee_names}</span> : null}
                </span>
                <span className={b.status === "cancelled" ? "text-bark-500" : "text-forest-800"}>
                  {b.status === "cancelled" ? "cancelled" : b.price_cents > 0 ? fmtEuro(b.price_cents) : b.status}
                </span>
              </li>
            ))}
            {bookings.length === 0 && <li className="py-3 text-sm text-bark-500">No bookings yet.</li>}
          </ul>
          <h3 className="mt-6 border-t border-oat-100 pt-4 font-semibold text-forest-900">Orders</h3>
          <ul className="mt-2 divide-y divide-oat-100">
            {orders.map((o) => (
              <li key={o.ref} className="flex items-center justify-between py-2 text-sm">
                <span className="font-mono text-xs">{o.ref}</span>
                <span className="text-bark-500">{fmtEuro(o.total_cents)} · {o.status}</span>
              </li>
            ))}
            {orders.length === 0 && <li className="py-2 text-sm text-bark-500">No orders.</li>}
          </ul>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Consent &amp; GDPR</h2>
        <p className="mt-2 text-sm text-bark-700">
          Marketing consent: <strong>{customer.marketing_consent ? "opted in" : "not opted in"}</strong>
          {customer.consent_at ? ` (recorded ${fmtDate(customer.consent_at, settings.timezone, true)})` : ""}.
        </p>
        <p className="mt-2 text-sm text-bark-700">
          To send this customer their data or delete it entirely, email them directly - the anonymise action below removes
          personal details while keeping anonymised history for accounts.
        </p>
        <form action={anonymiseCustomerAction} className="mt-4 flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={customer.id} />
          <input
            name="confirm"
            placeholder="Type ANONYMISE to confirm"
            className="rounded-xl border border-clay-600/40 px-4 py-3 text-sm"
            pattern="ANONYMISE"
            title="Type ANONYMISE"
          />
          <button type="submit" className="min-h-[44px] rounded-full bg-clay-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-clay-700">
            Anonymise this customer
          </button>
        </form>
      </Card>
    </div>
  );
}
