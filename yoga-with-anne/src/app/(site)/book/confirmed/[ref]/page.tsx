import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { get, all } from "@/db";
import { ButtonLink, Card, Alert } from "@/components/ui";
import { fmtEuro } from "@/lib/money";
import { getSettings, whatsappLink } from "@/lib/settings";
import { fmtDate, fmtDateTime } from "@/lib/tz";
import { stripeEnabled } from "@/lib/stripe";
import { PayPending } from "./pay-pending";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Booking confirmed", robots: { index: false } };

export default async function ConfirmedPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const order = get<{ id: number; ref: string; status: string; total_cents: number; pricing_snapshot: string | null }>(
    `SELECT * FROM orders WHERE ref = ?`,
    ref
  );
  if (!order) notFound();
  const settings = await getSettings();

  if (order.status !== "paid") {
    return (
      <PayPending
        ref_={ref}
        useStripe={stripeEnabled() && order.status === "awaiting_payment"}
        message={
          stripeEnabled()
            ? "We're just confirming your payment with Stripe - this usually takes a few seconds."
            : "Waiting for payment confirmation."
        }
      />
    );
  }

  const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = (SELECT customer_id FROM orders WHERE id = ?)`, order.id)!;
  const bookings = all<{ id: number; occurrence_id: number; status: string; price_cents: number; source: string }>(
    `SELECT * FROM bookings WHERE order_id = ?`,
    order.id
  );
  const attendeesByBooking = new Map<number, string[]>();
  if (bookings.length > 0) {
    const attendees = all<{ booking_id: number; name: string }>(
      `SELECT booking_id, name FROM booking_attendees WHERE booking_id IN (${bookings.map(() => "?").join(",")}) ORDER BY booking_id, sort, id`,
      ...bookings.map((booking) => booking.id)
    );
    for (const attendee of attendees) {
      attendeesByBooking.set(attendee.booking_id, [...(attendeesByBooking.get(attendee.booking_id) ?? []), attendee.name]);
    }
  }
  type OccRow = {
    id: number; title: string; starts_at: string; ends_at: string; venue_name: string | null; venue_address: string | null;
    event_kind: string | null; event_start_date: string | null; event_end_date: string | null;
  };
  const classRows = bookings
    .map((b) => {
      const occ = get<OccRow>(
        `SELECT o.id, o.title, o.starts_at, o.ends_at, v.name AS venue_name, v.address AS venue_address,
           cb.kind AS event_kind, cb.start_date AS event_start_date, cb.end_date AS event_end_date
         FROM class_occurrences o LEFT JOIN venues v ON v.id = o.venue_id
         LEFT JOIN class_blocks cb ON cb.series_id = o.series_id AND cb.kind IN ('workshop','retreat')
         WHERE o.id = ?`,
        b.occurrence_id
      );
      const attendees = all<{ name: string }>(`SELECT name FROM booking_attendees WHERE booking_id = ? ORDER BY sort, id`, b.id).map((row) => row.name);
      return occ ? {
        booking: b,
        occ,
        attendees: attendees.length ? attendees : attendeesByBooking.get(b.id) ?? [],
        venue: occ.venue_name ? { name: occ.venue_name, address: occ.venue_address } : null,
      } : null;
    })
    .filter((x) => x !== null);
  const classType = get<{ what_to_bring: string | null }>(`SELECT what_to_bring FROM class_types LIMIT 1`);
  const snapshot = order.pricing_snapshot ? JSON.parse(order.pricing_snapshot) as { result?: { chosen?: { label: string; explanation: string } } } : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="text-center">
        <span aria-hidden="true" className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-sage-100 text-forest-800">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path d="M8 17l5 5 11-12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h1 className="text-3xl font-semibold text-forest-900 sm:text-4xl">You&apos;re booked in!</h1>
        <p className="mt-2 text-lg text-bark-700">
          Order <strong>{order.ref}</strong> · a confirmation email is on its way to {customer.email}
        </p>
      </div>

      <div className="mt-8 space-y-4">
        {classRows.map(({ booking, occ, venue, attendees }) => (
          <Card key={booking.id} className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-forest-900">{occ!.title}</h2>
                <p className="mt-1 text-bark-700">
                  {occ!.event_start_date && occ!.event_end_date
                    ? `${fmtDate(`${occ!.event_start_date}T12:00:00.000Z`, settings.timezone, true)} – ${fmtDate(`${occ!.event_end_date}T12:00:00.000Z`, settings.timezone, true)}`
                    : fmtDateTime(occ!.starts_at, occ!.ends_at, settings.timezone)}
                </p>
                {attendees.length > 0 ? <p className="mt-1 text-sm text-bark-500">Attendees: {attendees.join(", ")}</p> : null}
                {venue && <p className="text-sm text-bark-500">{venue.name}{venue.address ? `, ${venue.address}` : ""}</p>}
              </div>
              <div className="text-right text-sm">
                {booking.price_cents > 0 ? (
                  <p className="font-semibold text-forest-900">{fmtEuro(booking.price_cents)}</p>
                ) : (
                  <p className="font-semibold text-forest-700">
                    {booking.source === "pass" ? "Pass credit used" : booking.source === "membership" ? "Membership" : "Included"}
                  </p>
                )}
                <p className="text-xs text-bark-500">{booking.status === "confirmed" ? "Confirmed" : booking.status}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <a href={`/api/ics/booking/${booking.id}`} className="inline-flex min-h-[40px] items-center rounded-full border border-forest-800/30 px-4 py-2 font-semibold text-forest-800 hover:bg-sage-100">
                📅 Add to calendar
              </a>
              <Link href={`/classes/${booking.occurrence_id}`} className="inline-flex min-h-[40px] items-center rounded-full border border-forest-800/30 px-4 py-2 font-semibold text-forest-800 hover:bg-sage-100">
                Class details
              </Link>
              <CancelBookingButton bookingId={booking.id} />
            </div>
          </Card>
        ))}

        {classRows.length === 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-forest-900">Your purchase</h2>
            <p className="mt-2 text-bark-700">Thank you - your pass or membership is now active. Sign in any time to see your credits.</p>
          </Card>
        )}

        <Card className="p-6">
          <h2 className="font-semibold text-forest-900">Payment</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-bark-500">Total {order.total_cents === 0 ? "" : "paid"}</dt><dd className="font-semibold">{fmtEuro(order.total_cents)}</dd></div>
            {snapshot?.result?.chosen && (
              <div className="text-xs text-bark-500">{snapshot.result.chosen.label} - {snapshot.result.chosen.explanation}</div>
            )}
          </dl>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-forest-900">What to bring</h2>
          <p className="mt-2 text-sm text-bark-700">{classType?.what_to_bring ?? "Comfortable clothes and water."}</p>
          <p className="mt-2 text-sm text-bark-700">
            Any questions or can&apos;t make it? WhatsApp Anne on{" "}
            <a href={whatsappLink(settings)} target="_blank" rel="noopener noreferrer" className="font-semibold text-forest-800 underline underline-offset-4">
              {settings.contact_phone_display}
            </a>{" "}
            - the more notice the better.
          </p>
        </Card>

          <Alert kind="info">
            <span className="font-semibold">Manage your bookings:</span> sign in any time with your email -{" "}
            <Link href="/account" className="underline underline-offset-4">My bookings</Link>. You can also{" "}
            <PrintButton>print this page</PrintButton> as a plain summary.
          </Alert>

        <div className="text-center">
          <ButtonLink href="/classes" variant="secondary">Book another date</ButtonLink>
        </div>
      </div>
    </div>
  );
}

function CancelBookingButton({ bookingId }: { bookingId: number }) {
  return (
    <Link
      href={`/account?cancel=${bookingId}`}
      className="inline-flex min-h-[40px] items-center rounded-full border border-clay-600/40 px-4 py-2 font-semibold text-clay-700 hover:bg-clay-100"
    >
      Cancel
    </Link>
  );
}
