import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { get, all, nowIso } from "@/db";
import { requireCustomer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fmtDateTime, fmtDate } from "@/lib/tz";
import { fmtEuro } from "@/lib/money";
import { Card, Alert, ButtonLink } from "@/components/ui";
import { accountLogout, customerCancelBooking, updateConsent, openBillingPortal } from "../actions";
import { entitlementsForCustomer } from "@/lib/customers";
import { stripeEnabled } from "@/lib/stripe";

export const metadata: Metadata = { title: "My bookings", robots: { index: false } };

export default async function AccountHome({
  searchParams,
}: {
  searchParams: Promise<{ cancel?: string; cancelled?: string; error?: string }>;
}) {
  const { cancel, cancelled, error } = await searchParams;
  const customer = await requireCustomer();
  if (!customer) redirect("/account");
  const [settings, entitlements] = await Promise.all([getSettings(), entitlementsForCustomer(customer.id)]);
  const now = nowIso();
  const marketingConsent = !!get<{ marketing_consent: number }>(
    `SELECT marketing_consent FROM customers WHERE id = ?`,
    customer.id
  )?.marketing_consent;

  const bookings = all<{
    id: number; status: string; source: string; price_cents: number; occurrence_id: number;
    seat_count: number; attendee_names: string | null; title: string; starts_at: string; ends_at: string; venue_name: string | null;
  }>(
    `SELECT b.id, b.status, b.source, b.price_cents, b.occurrence_id, b.seat_count,
       (SELECT group_concat(name, ', ') FROM booking_attendees WHERE booking_id = b.id ORDER BY sort, id) AS attendee_names,
       o.title, o.starts_at, o.ends_at, v.name AS venue_name
     FROM bookings b
     JOIN class_occurrences o ON o.id = b.occurrence_id
     LEFT JOIN venues v ON v.id = o.venue_id
     WHERE b.customer_id = ? AND b.status IN ('confirmed','attended') AND o.starts_at >= ?
     ORDER BY o.starts_at ASC`,
    customer.id, now
  );
  const pastBookings = all<typeof bookings[number]>(
     `SELECT b.id, b.status, b.source, b.price_cents, b.occurrence_id, b.seat_count,
       (SELECT group_concat(name, ', ') FROM booking_attendees WHERE booking_id = b.id ORDER BY sort, id) AS attendee_names,
       o.title, o.starts_at, o.ends_at, v.name AS venue_name
     FROM bookings b
     JOIN class_occurrences o ON o.id = b.occurrence_id
     LEFT JOIN venues v ON v.id = o.venue_id
     WHERE b.customer_id = ? AND (b.status IN ('cancelled','no_show') OR o.starts_at < ?)
     ORDER BY o.starts_at DESC LIMIT 20`,
    customer.id, now
  );
  const orders = all<{ ref: string; status: string; total_cents: number; created_at: string }>(
    `SELECT ref, status, total_cents, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10`,
    customer.id
  );
  const cancelBookingRow = cancel
    ? get<{ id: number; title: string; starts_at: string }>(
        `SELECT b.id, o.title, o.starts_at FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id WHERE b.id = ? AND b.customer_id = ? AND b.status = 'confirmed'`,
        Number(cancel), customer.id
      )
    : null;
  const withinCutoff = cancelBookingRow
    ? new Date(cancelBookingRow.starts_at).getTime() - Date.now() > settings.cancellation_cutoff_hours * 3600 * 1000
    : false;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-forest-900 sm:text-4xl">
            Hello{customer.name ? `, ${customer.name.split(" ")[0]}` : ""} 👋
          </h1>
          <p className="mt-1 text-bark-500">{customer.email}</p>
        </div>
        <form action={accountLogout}>
          <button type="submit" className="text-sm font-semibold text-bark-500 underline underline-offset-4">Sign out</button>
        </form>
      </div>

      {cancelled ? <div className="mt-6"><Alert kind="success">Your booking has been cancelled.</Alert></div> : null}
      {error ? <div className="mt-6"><Alert kind="error">We couldn&apos;t find that booking.</Alert></div> : null}

      {/* Cancel confirmation */}
      {cancelBookingRow && (
        <div className="mt-8">
          <Card className="border-clay-600/40 p-6">
            <h2 className="text-lg font-semibold text-forest-900">Cancel this booking?</h2>
            <p className="mt-2 text-bark-700">
              <strong>{cancelBookingRow.title}</strong> - {fmtDateTime(cancelBookingRow.starts_at, cancelBookingRow.starts_at, settings.timezone)}
            </p>
            <p className="mt-3 rounded-xl bg-oat-100 px-4 py-3 text-sm text-bark-700">
              {withinCutoff
                ? `You're inside the free cancellation window (${settings.cancellation_cutoff_hours} hours before class). ${
                    entitlements.passes.length > 0 ? "A pass credit will be returned automatically." : "A refund will be arranged to your original payment method."
                  }`
                : `This is inside the late-cancellation window (${settings.cancellation_cutoff_hours} hours before class). No automatic refund applies, but Anne will always try to be fair - you can also message her on ${settings.contact_phone_display}.`}
            </p>
            <div className="mt-4 flex gap-3">
              <form action={customerCancelBooking}>
                <input type="hidden" name="bookingId" value={cancelBookingRow.id} />
                <button type="submit" className="min-h-[48px] rounded-full bg-clay-600 px-6 py-3 font-semibold text-white hover:bg-clay-700">
                  Yes, cancel my place
                </button>
              </form>
              <Link href="/account/home" className="inline-flex min-h-[48px] items-center rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800">
                Keep my booking
              </Link>
            </div>
          </Card>
        </div>
      )}

      {/* Passes & membership */}
      <section className="mt-10 grid gap-4 md:grid-cols-2" aria-label="Passes and membership">
        {entitlements.passes.map((p) => (
          <Card key={p.passId} className="p-6">
            <h2 className="font-semibold text-forest-900">{p.label}</h2>
            <p className="mt-2 font-display text-3xl font-semibold text-forest-800">
              {p.creditsLeft} <span className="text-base font-normal text-bark-500">credit{p.creditsLeft === 1 ? "" : "s"} left</span>
            </p>
            <p className="mt-1 text-sm text-bark-500">Valid until {fmtDate(p.expiresAt, settings.timezone, true)}</p>
            <div className="mt-4"><ButtonLink href="/classes" variant="small">Use a credit →</ButtonLink></div>
          </Card>
        ))}
        {entitlements.membership ? (
          <Card className="p-6">
            <h2 className="font-semibold text-forest-900">{entitlements.membership.label}</h2>
            <p className="mt-2 text-sm text-bark-700">Active - covers all regular weekly classes.</p>
            <p className="mt-1 text-sm text-bark-500">Current period ends {fmtDate(entitlements.membership.periodEnd, settings.timezone, true)}</p>
            {stripeEnabled() ? (
              <form action={openBillingPortal} className="mt-3">
                <button type="submit" className="min-h-[40px] rounded-full border border-forest-800/30 px-4 py-2 text-xs font-semibold text-forest-800 hover:bg-sage-100">
                  Manage payment &amp; cancellation
                </button>
              </form>
            ) : (
              <p className="mt-3 text-xs text-bark-500">To pause or cancel your membership, message Anne on {settings.contact_phone_display}.</p>
            )}
          </Card>
        ) : null}
        {entitlements.passes.length === 0 && !entitlements.membership && (settings.class_passes_enabled || settings.memberships_enabled) ? (
          <Card className="p-6">
            <h2 className="font-semibold text-forest-900">No pass or membership yet</h2>
            <p className="mt-2 text-sm text-bark-700">If you come regularly, a pass or membership is cheaper per class.</p>
            <div className="mt-4"><ButtonLink href="/prices" variant="small">See options</ButtonLink></div>
          </Card>
        ) : null}
      </section>

      {/* Upcoming bookings */}
      <section className="mt-12" aria-labelledby="upcoming">
        <h2 id="upcoming" className="text-xl font-semibold text-forest-900">Upcoming bookings</h2>
        <div className="mt-4 space-y-3">
          {bookings.length === 0 ? (
            <Card className="p-6 text-bark-500">No upcoming classes booked. <Link href="/classes" className="font-semibold text-forest-800 underline underline-offset-4">Find a date →</Link></Card>
          ) : (
            bookings.map((b) => (
              <Card key={b.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-semibold text-forest-900">{b.title}</p>
                  <p className="text-sm text-bark-500">{fmtDateTime(b.starts_at, b.ends_at, settings.timezone)}{b.venue_name ? ` · ${b.venue_name}` : ""}</p>
                  {b.attendee_names ? <p className="text-sm text-bark-500">Attendees: {b.attendee_names}</p> : null}
                  <p className="mt-0.5 text-xs text-bark-500">
                    {b.price_cents > 0 ? fmtEuro(b.price_cents) : b.source === "pass" ? "Pass credit" : b.source === "membership" ? "Membership" : "Included"}
                    {" · "}
                    <a href={`/api/ics/booking/${b.id}`} className="underline underline-offset-4">Add to calendar</a>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link href={`/classes/${b.occurrence_id}`} className="text-sm font-semibold text-forest-800 underline underline-offset-4">Details</Link>
                  <Link href={`/account/home?cancel=${b.id}`} className="text-sm font-semibold text-clay-700 underline underline-offset-4">Cancel</Link>
                </div>
              </Card>
            ))
          )}
        </div>
      </section>

      {/* Past bookings */}
      {pastBookings.length > 0 && (
        <section className="mt-12" aria-labelledby="past">
          <h2 id="past" className="text-xl font-semibold text-forest-900">Earlier bookings</h2>
          <div className="mt-4 space-y-2">
            {pastBookings.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-oat-200 bg-white px-5 py-3 text-sm">
                <span className="text-bark-700">{b.title}</span>
                <span className="flex items-center gap-3 text-bark-500">
                  {fmtDate(b.starts_at, settings.timezone)}
                  <span className={b.status === "cancelled" ? "rounded-full bg-oat-100 px-2 py-0.5 text-xs" : "rounded-full bg-sage-100 px-2 py-0.5 text-xs text-forest-800"}>
                    {b.status === "cancelled" ? "cancelled" : b.status === "attended" ? "attended" : b.status === "no_show" ? "no-show" : "booked"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Orders */}
      <section className="mt-12" aria-labelledby="orders">
        <h2 id="orders" className="text-xl font-semibold text-forest-900">Receipts</h2>
        <div className="mt-4 space-y-2">
          {orders.map((o) => (
            <div key={o.ref} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-oat-200 bg-white px-5 py-3 text-sm">
              <span className="font-semibold text-forest-900">{o.ref}</span>
              <span className="text-bark-500">{fmtDate(o.created_at, settings.timezone, true)}</span>
              <span className="font-semibold">{fmtEuro(o.total_cents)}</span>
              <span className={o.status === "paid" ? "rounded-full bg-sage-100 px-2 py-0.5 text-xs text-forest-800" : "rounded-full bg-oat-100 px-2 py-0.5 text-xs text-bark-500"}>{o.status}</span>
            </div>
          ))}
          {orders.length === 0 && <Card className="p-6 text-bark-500">No receipts yet.</Card>}
        </div>
      </section>

      {/* Preferences & data */}
      <section className="mt-12" aria-labelledby="prefs">
        <h2 id="prefs" className="text-xl font-semibold text-forest-900">Your preferences &amp; data</h2>
        <Card className="mt-4 p-6">
          <form action={updateConsent} className="flex flex-wrap items-center justify-between gap-4">
            <label className="flex items-start gap-3 text-sm text-bark-700">
              <input
                type="checkbox"
                name="marketing"
                defaultChecked={marketingConsent}
                className="mt-1 h-5 w-5 rounded accent-forest-800"
              />
              <span>Email me occasional news from Yoga with Anne (one or two a month at most).</span>
            </label>
            <button type="submit" className="min-h-[44px] rounded-full border-2 border-forest-800 px-5 py-2 font-semibold text-forest-800">Save</button>
          </form>
          <p className="mt-4 border-t border-oat-100 pt-4 text-sm text-bark-500">
            Want a copy of your data, or your details deleted? You can{" "}
            <a href="/api/account/export" className="font-semibold text-forest-800 underline underline-offset-4">download everything we hold about you</a>{" "}
            instantly, or email{" "}
            <a href={`mailto:${settings.contact_email}`} className="text-forest-800 underline underline-offset-4">{settings.contact_email}</a> and we&apos;ll correct or delete it within 30 days.
          </p>
        </Card>
      </section>
    </div>
  );
}
