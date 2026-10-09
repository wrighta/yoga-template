import type { Metadata } from "next";
import Link from "next/link";
import { listWorkshopViews } from "@/lib/blocks";
import { fmtEuro } from "@/lib/money";
import { fmtDate } from "@/lib/tz";
import { getSettings } from "@/lib/settings";

function eventTimeLabel(scheduleJson: string | null, kind: string): string | null {
  if (!scheduleJson) return null;
  try {
    const schedule = JSON.parse(scheduleJson) as { mode?: string; start?: string; end?: string };
    if (schedule.mode !== "same" || !schedule.start || !schedule.end) return "Different hours each day";
    const formatTime = (time: string) => {
      const [hourText, minute] = time.split(":");
      const hour = Number(hourText);
      return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
    };
    const prefix = kind === "retreat" ? "Each day" : "Hours";
    return `${prefix}: ${formatTime(schedule.start)} to ${formatTime(schedule.end)}`;
  } catch {
    return null;
  }
}

export const metadata: Metadata = {
  title: "Workshops & Retreats",
  description: "Yoga workshops and retreats in Lucan - special events with one simple booking.",
  alternates: { canonical: "/workshops" },
};

export default async function WorkshopsPage() {
  const [workshops, settings] = await Promise.all([listWorkshopViews(), getSettings()]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold text-forest-900 sm:text-5xl">Workshops &amp; Retreats</h1>
        <p className="mt-4 text-lg text-bark-700">
          Special events with one booking for the whole experience. See each event&apos;s date range and itinerary below.
        </p>
      </div>

      {workshops.length === 0 ? (
        <div className="mt-10 rounded-[var(--radius-card)] bg-white p-10 text-center border border-oat-200">
          <p className="text-lg text-bark-700">No workshops or retreats scheduled right now.</p>
          <p className="mt-2 text-bark-500">
            New dates are added regularly - <Link href="/enquire" className="font-semibold text-forest-800 underline underline-offset-4">register your interest</Link> and
            you&apos;ll be the first to know.
          </p>
        </div>
      ) : (
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {workshops.map((w) => {
            const startLabel = fmtDate(`${w.start_date}T12:00:00.000Z`, settings.timezone, true);
            const endLabel = fmtDate(`${w.end_date}T12:00:00.000Z`, settings.timezone, true);
            const datesLabel = startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
            return (
              <article key={w.id} className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-oat-200 bg-white">
                {w.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.imageUrl} alt={w.name} className="h-56 w-full object-cover" loading="lazy" />
                ) : null}
                <div className="flex flex-1 flex-col gap-3 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase text-clay-700">{w.kind === "retreat" ? "Retreat" : "Workshop"}</p>
                      <h2 className="text-xl font-semibold text-forest-900">{w.name}</h2>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-sage-300 bg-sage-100 px-3 py-1 text-sm font-semibold text-forest-800">
                      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
                      {w.stateLabel}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-forest-800">{datesLabel}</p>
                  {eventTimeLabel(w.daily_times_json, w.kind) ? <p className="text-sm text-bark-700">{eventTimeLabel(w.daily_times_json, w.kind)}</p> : null}
                  <p className="text-sm text-bark-500">{w.venueName ?? ""}{w.classTypeName ? ` · ${w.classTypeName}` : ""}</p>
                  {w.description ? <p className="text-sm leading-relaxed text-bark-700">{w.description}</p> : null}

                  <div className="mt-auto pt-2">
                    <Link href={`/classes/${w.dates[0]?.occurrenceId ?? 0}`} className="text-sm font-semibold text-forest-800 underline underline-offset-4">
                      View event details
                    </Link>
                    {w.isEarlyBird ? (
                      <p className="text-sm">
                        <strong className="text-forest-900">{fmtEuro(w.effectivePrice)}</strong>{" "}
                        <span className="text-bark-500 line-through">{fmtEuro(w.price_cents)}</span>{" "}
                        <span className="rounded-full bg-gold-200 px-2 py-0.5 text-xs font-bold text-gold-800">
                          Early bird until {fmtDate(`${w.early_bird_until}T12:00:00.000Z`, settings.timezone, true)}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm"><strong className="text-forest-900">{fmtEuro(w.effectivePrice)}</strong> <span className="text-bark-500">per person</span></p>
                    )}
                    {w.onSale ? (
                      <Link
                        href={`/book?block=${w.id}`}
                        className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900"
                      >
                        Book your place - {fmtEuro(w.effectivePrice)}
                      </Link>
                    ) : w.kind === "workshop" || w.kind === "retreat" ? (
                      <p className="mt-3 rounded-full bg-oat-100 px-4 py-3 text-center text-sm font-semibold text-bark-500">Sold out</p>
                    ) : (
                      <Link
                        href={`/classes/${w.dates[0]?.occurrenceId ?? 0}`}
                        className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800 hover:bg-sage-100"
                      >
                        Sold out - join the waitlist
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
