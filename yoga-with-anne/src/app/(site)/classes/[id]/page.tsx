import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink, Card, StateBadge, Alert } from "@/components/ui";
import { ClassSelectButton } from "@/components/class-select-button";
import { getOccurrenceView } from "@/lib/schedule";
import { all, get, get as dbGet } from "@/db";
import { getSettings, whatsappLink } from "@/lib/settings";
import { isMultiDateDiscountActive } from "@/lib/settings";
import { fmtEuro } from "@/lib/money";
import { fmtDate } from "@/lib/tz";
import { WaitlistForm } from "./waitlist-form";
import { getBlockView } from "@/lib/blocks";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const view = await getOccurrenceView(Number(id));
  if (!view) return { title: "Class not found" };
  const event = get<{ kind: string; start_date: string; end_date: string; description: string | null }>(
    `SELECT cb.kind, cb.start_date, cb.end_date, cb.description FROM class_blocks cb
     JOIN class_series cs ON cs.id = cb.series_id JOIN class_occurrences o ON o.series_id = cs.id
     WHERE o.id = ? AND cb.kind IN ('workshop','retreat') AND cb.publication_status = 'published' AND cs.publication_status = 'published' LIMIT 1`, Number(id)
  );
  const display = event
    ? `${fmtDate(`${event.start_date}T12:00:00.000Z`, "Europe/Dublin", true)} – ${fmtDate(`${event.end_date}T12:00:00.000Z`, "Europe/Dublin", true)}`
    : view.display;
  return {
    title: `${view.title} - ${display}`,
    description: event?.description ?? `${view.title} in Lucan on ${display}. ${view.suitability ?? "All levels welcome."}`,
    alternates: { canonical: `/classes/${id}` },
    openGraph: {
      title: `${view.title} - ${display}`,
      description: event?.description ?? view.suitability ?? "Gentle yoga & meditation in Lucan. All levels welcome.",
      url: `/classes/${id}`,
      images: [{ url: `/api/og?title=${encodeURIComponent(`${view.title}, ${display}`)}`, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ joined?: string; waitlist_error?: string }>;
}) {
  const { id } = await params;
  const { joined, waitlist_error } = await searchParams;
  const view = await getOccurrenceView(Number(id));
  if (!view) notFound();
  const multiDateActive = await isMultiDateDiscountActive();
  const [settings, classType, venue] = await Promise.all([
    getSettings(),
    Promise.resolve(dbGet<{ name: string; description: string | null; suitability: string | null; what_to_bring: string | null; accessibility_note: string | null }>(
      `SELECT name, description, suitability, what_to_bring, accessibility_note FROM class_types WHERE id = ?`,
      view.class_type_id
    )),
    view.venue_id
      ? Promise.resolve(get<{ name: string; address: string | null; map_url: string | null; parking_notes: string | null; access_notes: string | null; directions: string | null }>(
          `SELECT name, address, map_url, parking_notes, access_notes, directions FROM venues WHERE id = ?`,
          view.venue_id
        ))
      : Promise.resolve(null),
  ]);
  const eventOffering = get<{ id: number; kind: string; name: string; start_date: string; end_date: string; price_cents: number; description: string | null; daily_times_json: string | null }>(
    `SELECT cb.id, cb.kind, cb.name, cb.start_date, cb.end_date, cb.price_cents, cb.description, cb.daily_times_json
     FROM class_blocks cb JOIN class_series cs ON cs.id = cb.series_id JOIN class_occurrences o ON o.series_id = cs.id
     WHERE o.id = ? AND cb.kind IN ('workshop','retreat') AND cb.publication_status = 'published' AND cs.publication_status = 'published' LIMIT 1`, view.id
  );
  const eventBlockView = eventOffering ? await getBlockView(eventOffering.id) : null;
  const eventEarlyBird = !!eventBlockView?.isEarlyBird;
  const eventEffectivePrice = eventBlockView?.effectivePrice ?? eventOffering?.price_cents ?? 0;
  const eventEarlyBirdUntil = eventBlockView?.early_bird_until ?? "";
  const scheduleDisplay = eventOffering
    ? eventOffering.start_date === eventOffering.end_date
      ? fmtDate(`${eventOffering.start_date}T12:00:00.000Z`, settings.timezone, true)
      : `${fmtDate(`${eventOffering.start_date}T12:00:00.000Z`, settings.timezone, true)} – ${fmtDate(`${eventOffering.end_date}T12:00:00.000Z`, settings.timezone, true)}`
    : view.display;
  const singleDayEvent = !!eventOffering && eventOffering.start_date === eventOffering.end_date;
  let eventSchedule: { mode: "same"; start: string; end: string } | { mode: "daily"; days: { date: string; start: string; end: string }[] } | null = null;
  if (eventOffering?.daily_times_json) {
    try {
      const parsed = JSON.parse(eventOffering.daily_times_json) as { mode?: string; start?: string; end?: string; days?: { date: string; start: string; end: string }[] };
      if (parsed.mode === "same" && parsed.start && parsed.end) eventSchedule = { mode: "same", start: parsed.start, end: parsed.end };
      if (parsed.mode === "daily" && Array.isArray(parsed.days)) eventSchedule = { mode: "daily", days: parsed.days };
    } catch {
      eventSchedule = null;
    }
  }
  const displayTime = (time: string) => {
    const [hourText, minute] = time.split(":");
    const hour = Number(hourText);
    return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
  };

  // does this date belong to an on-sale block?
  const blockLinks = view.status === "scheduled"
    ? all<{ id: number }>(
        `SELECT cb.id FROM class_blocks cb JOIN class_series cs ON cs.id = cb.series_id
         JOIN class_occurrences o ON o.series_id = cs.id
         WHERE o.id = ? AND cb.active = 1 AND cb.kind = 'block' AND cb.publication_status = 'published' AND cs.publication_status = 'published' AND cb.start_date <= substr(?, 1, 10) AND cb.end_date >= substr(?, 1, 10)`,
        view.id, view.starts_at, view.starts_at
      )
    : [];
  const parentBlocks = (await Promise.all(blockLinks.map((b) => getBlockView(b.id)))).filter(
    (b): b is NonNullable<typeof b> => !!b && b.active === 1 && b.onSale
  );

  const eventJsonLd = view.status === "scheduled"
    ? {
        "@context": "https://schema.org",
        "@type": "Event",
        name: `${view.title} - ${settings.business_name}`,
        startDate: view.starts_at,
        endDate: view.ends_at,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: venue
          ? { "@type": "Place", name: venue.name, address: { "@type": "PostalAddress", streetAddress: venue.address, addressLocality: "Lucan", addressCountry: "IE" } }
          : undefined,
        description: classType?.description ?? undefined,
        organizer: { "@type": "Person", name: "Anne Wright" },
        offers: {
          "@type": "Offer",
          price: (view.effective_price_cents / 100).toFixed(2),
          priceCurrency: "EUR",
          availability: view.remaining > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
          url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/classes/${view.id}`,
        },
      }
    : null;
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/` },
      { "@type": "ListItem", position: 2, name: "Classes & Schedule", item: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/classes` },
      { "@type": "ListItem", position: 3, name: view.title },
    ],
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href="/classes" className="text-sm font-semibold text-forest-800 underline underline-offset-4">
        ← Back to classes
      </Link>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-forest-900 sm:text-4xl">{view.title}</h1>
          <p className="mt-2 text-lg text-bark-700">{scheduleDisplay}</p>
          {eventSchedule ? (
            <div className="mt-4 rounded-lg bg-sage-100 p-4 text-sm text-forest-900">
              <h2 className="font-semibold">{eventOffering?.kind === "retreat" && !singleDayEvent ? "Daily retreat times" : eventOffering?.kind === "retreat" ? "Retreat hours" : "Workshop hours"}</h2>
              {eventSchedule.mode === "same" ? (
                <p className="mt-1">{eventOffering?.kind === "retreat" && !singleDayEvent ? "Each day: " : ""}{displayTime(eventSchedule.start)} to {displayTime(eventSchedule.end)}</p>
              ) : (
                <ul className="mt-2 space-y-1">{eventSchedule.days.map((day) => <li key={day.date}>{fmtDate(`${day.date}T12:00:00.000Z`, settings.timezone, true)}: {displayTime(day.start)} to {displayTime(day.end)}</li>)}</ul>
              )}
            </div>
          ) : null}
        </div>
        <StateBadge state={view.state} label={view.state_label} />
      </div>

      {joined ? (
        <div className="mt-6">
          <Alert kind="success">You&apos;re on the waitlist - Anne will email you the moment a place opens up. No payment was taken.</Alert>
        </div>
      ) : null}
      {waitlist_error ? (
        <div className="mt-6">
          <Alert kind="error">{waitlist_error}</Alert>
        </div>
      ) : null}

      {eventJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(eventJsonLd) }} />
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold text-forest-900">{eventOffering ? (eventOffering.kind === "retreat" ? "About this retreat" : "About this workshop") : "About this class"}</h2>
            <p className="mt-3 leading-relaxed text-bark-700">{eventOffering?.description ?? classType?.description}</p>
            {classType?.suitability && (
              <>
                <h3 className="mt-5 font-semibold text-forest-900">Who it suits</h3>
                <p className="mt-1 leading-relaxed text-bark-700">{classType.suitability}</p>
              </>
            )}
            {view.notes_public && (
              <p className="mt-5 rounded-xl bg-gold-200/50 px-4 py-3 text-sm font-medium text-gold-700">{view.notes_public}</p>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold text-forest-900">Good to know</h2>
            <dl className="mt-3 space-y-4 text-sm leading-relaxed">
              {classType?.what_to_bring && (
                <div>
                  <dt className="font-semibold text-forest-900">What to bring</dt>
                  <dd className="text-bark-700">{classType.what_to_bring}</dd>
                </div>
              )}
              {classType?.accessibility_note && (
                <div>
                  <dt className="font-semibold text-forest-900">Accessibility &amp; wellbeing</dt>
                  <dd className="text-bark-700">{classType.accessibility_note}</dd>
                </div>
              )}
              <div>
                <dt className="font-semibold text-forest-900">Cancellations</dt>
                <dd className="text-bark-700">
                  Cancel up to {settings.cancellation_cutoff_hours} hours before the class for a full refund or a returned
                  pass credit.{" "}
                  <Link href="/policies/booking-terms" className="underline underline-offset-4">
                    Full booking terms
                  </Link>
                </dd>
              </div>
            </dl>
            <p className="mt-5 text-xs leading-relaxed text-bark-500">
              Yoga classes are not medical treatment. If you have an injury or health concern, please check with your doctor
              first and message Anne on {settings.contact_phone_display} so she can suggest suitable adaptations.
            </p>
          </Card>

          {venue && (
            <Card className="p-6">
              <h2 className="text-xl font-semibold text-forest-900">{venue.name}</h2>
              <p className="mt-2 text-bark-700">{venue.address}</p>
              {venue.directions && <p className="mt-2 text-sm text-bark-700">{venue.directions}</p>}
              {venue.parking_notes && <p className="mt-2 text-sm text-bark-700">🅿 {venue.parking_notes}</p>}
              {venue.access_notes && <p className="mt-2 text-sm text-bark-700">♿ {venue.access_notes}</p>}
              {venue.map_url && (
                <a href={venue.map_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block font-semibold text-forest-800 underline underline-offset-4">
                  Open in Google Maps →
                </a>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {parentBlocks.map((b) => (
            <Card key={b.id} className="border-clay-500 p-6">
              <p className="text-sm font-bold uppercase tracking-wider text-clay-700">Better value</p>
              <h2 className="mt-1 font-semibold text-forest-900">{b.name}</h2>
              <p className="mt-1 text-sm text-bark-700">
                This class is part of a {b.classCount}-week block. Book the whole block for{" "}
                <strong>{fmtEuro(b.price_cents)}</strong> (≈ {fmtEuro(b.perClassCents)} per class) and your place is
                reserved for every date.
              </p>
              <Link
                href={`/book?block=${b.id}`}
                className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900"
              >
                Book the block - {fmtEuro(b.price_cents)}
              </Link>
            </Card>
          ))}

          {eventOffering ? (
          <Card className="p-6">
            <p className="text-sm text-bark-500">Whole event · per person</p>
            {eventEarlyBird ? (
              <>
                <p className="font-display text-3xl font-semibold text-forest-900">
                  {fmtEuro(eventEffectivePrice)} <span className="text-lg font-normal text-bark-500 line-through">{fmtEuro(eventOffering.price_cents)}</span>
                </p>
                <p className="mt-1"><span className="rounded-full bg-gold-200 px-2 py-0.5 text-xs font-bold text-gold-800">Early bird until {fmtDate(`${eventEarlyBirdUntil}T12:00:00.000Z`, settings.timezone, true)}</span></p>
              </>
            ) : (
              <p className="font-display text-3xl font-semibold text-forest-900">{fmtEuro(eventOffering.price_cents)}</p>
            )}
            <p className="mt-2 text-sm text-bark-700">One booking covers the full event. Add places for friends and name each attendee at checkout.</p>
            <p className="mt-3 text-sm text-bark-700">{view.remaining} of {view.capacity} places available</p>
            {view.remaining > 0 ? (
              <Link href={`/book?block=${eventOffering.id}`} className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900">
                Book this {eventOffering.kind}
              </Link>
            ) : <p className="mt-5 rounded-full bg-oat-100 px-4 py-3 text-center text-sm font-semibold text-bark-500">Sold out</p>}
          </Card>
          ) : (
          <Card className="p-6">
            <p className="text-sm text-bark-500">Price from</p>
            <p className="font-display text-3xl font-semibold text-forest-900">{fmtEuro(view.effective_price_cents)}</p>
            <p className="mt-1 text-sm text-bark-500">
              {multiDateActive ? "per class · book 2–4 dates together and each one is less" : "per class"}
            </p>
            <p className="mt-3 text-sm text-bark-700">
              {view.remaining > 0
                ? `${view.remaining} of ${view.capacity} places available`
                : view.waitlist_enabled
                  ? "Class is full - waitlist open"
                  : "Class is full"}
            </p>
            <div className="mt-5">
              {view.bookable ? (
                <ClassSelectButton occurrenceId={view.id} label={`Select ${view.display}`} />
              ) : view.state === "full_waitlist" ? (
                <WaitlistForm occurrenceId={view.id} />
              ) : (
                <ButtonLink href="/classes" variant="secondary">See other dates</ButtonLink>
              )}
            </div>
            {view.bookable && (
              <p className="mt-3 text-xs text-bark-500">
                You&apos;ll pick your place(s) at checkout - nothing is charged until you confirm.
              </p>
            )}
          </Card>
          )}

          <Card className="p-6">
            <h2 className="font-semibold text-forest-900">Prefer to just ask?</h2>
            <p className="mt-2 text-sm text-bark-700">
              Message Anne on WhatsApp - she&apos;ll happily add you to the class list and answer any questions.
            </p>
            <a
              href={whatsappLink(settings)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-[48px] items-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900"
            >
              WhatsApp {settings.contact_phone_display}
            </a>
          </Card>
        </div>
      </div>
    </div>
  );
}
