import type { Metadata } from "next";
import { ClassCard, type ClassCardData } from "@/components/class-card";
import { CartBar } from "@/components/cart-bar";
import { Alert } from "@/components/ui";
import { listUpcoming } from "@/lib/schedule";
import { releaseExpiredHolds } from "@/lib/booking";
import { getSettings, isMultiDateDiscountActive } from "@/lib/settings";
import { listActiveBlockViews, listActiveBundleViews } from "@/lib/blocks";
import { BlockCard, BundleCard } from "@/components/block-cards";

export const metadata: Metadata = {
  title: "Classes & Schedule",
  description:
    "Upcoming gentle yoga and meditation classes in Lucan - book your place in seconds, no account needed.",
  alternates: { canonical: "/classes" },
};

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ waitlist_error?: string }>;
}) {
  const { waitlist_error } = await searchParams;
  releaseExpiredHolds();
  const [settings, classes, multiDateActive, blocks, bundles] = await Promise.all([getSettings(), listUpcoming(60), isMultiDateDiscountActive(), listActiveBlockViews(), listActiveBundleViews()]);
  const cardData: ClassCardData[] = classes.map((c) => ({
    id: c.id,
    title: c.title,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    display: c.display,
    venueName: c.venue_name,
    instructorName: c.instructor_name,
    typeName: c.class_type_name,
    priceCents: c.effective_price_cents,
    multiDateEligible: c.multiDateEligible,
    remaining: c.remaining,
    capacity: c.capacity,
    state: c.state,
    stateLabel: c.state_label,
    bookable: c.bookable,
  }));

  // Group into a readable week-by-week agenda (local weeks, Mon–Sun)
  const weeks: { label: string; items: ClassCardData[] }[] = [];
  for (const c of cardData) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(new Date(c.startsAt));
    const y = Number(parts.find((p) => p.type === "year")!.value);
    const m = Number(parts.find((p) => p.type === "month")!.value);
    const day = Number(parts.find((p) => p.type === "day")!.value);
    const jsDate = new Date(Date.UTC(y, m - 1, day));
    const dow = (jsDate.getUTCDay() + 6) % 7; // 0 = Monday
    jsDate.setUTCDate(jsDate.getUTCDate() - dow);
    const weekKey = jsDate.toISOString().slice(0, 10);
    let week = weeks.find((w) => w.label === weekKey);
    if (!week) {
      week = { label: weekKey, items: [] };
      weeks.push(week);
    }
    week.items.push(c);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold text-forest-900 sm:text-5xl">Classes &amp; schedule</h1>
        <p className="mt-4 text-lg text-bark-700">
          {multiDateActive
            ? "Choose the dates you want and select several together to get the multi-date rate. No account needed."
            : "Choose the date that suits you and book in seconds. No account needed."}
        </p>
      </div>

      {waitlist_error ? (
        <div className="mt-6">
          <Alert kind="error">{waitlist_error}</Alert>
        </div>
      ) : null}

      {blocks.length + bundles.length > 0 ? (
        <section className="mt-10" aria-labelledby="blocks-heading">
          <h2 id="blocks-heading" className="mb-1 text-2xl font-semibold text-forest-900">
            Book a block of classes
          </h2>
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
            {blocks.map((b) => (
              <BlockCard key={b.id} block={b} />
            ))}
            {bundles.map((b) => (
              <BundleCard key={`bundle-${b.id}`} bundle={b} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-10 space-y-12 pb-28">
        {weeks.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-oat-200 bg-white p-8 text-center sm:p-10">
            <p className="text-lg font-medium text-bark-800">
              {settings.no_classes_notice || "No upcoming classes currently scheduled."}
            </p>
            <p className="mt-2 text-sm text-bark-500">
              {settings.no_classes_notice
                ? "Check back soon, or message Anne on WhatsApp if you have questions about upcoming dates."
                : "New dates will appear here shortly. Or message Anne on WhatsApp to be added to the list."}
            </p>
          </div>
        ) : (
          weeks.map((w) => {
            const first = w.items[0]?.startsAt ?? w.label;
            const label =
              w.items.length === 1
                ? new Intl.DateTimeFormat("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: settings.timezone }).format(new Date(first))
                : `Week of ${new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "long", timeZone: settings.timezone }).format(new Date(first))}`;
            return (
              <section key={w.label} aria-labelledby={`wk-${w.label}`}>
                <h2 id={`wk-${w.label}`} className="mb-4 flex items-center gap-3 text-sm font-bold uppercase tracking-wider text-bark-500">
                  {label}
                  <span aria-hidden="true" className="h-px flex-1 bg-oat-200" />
                </h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {w.items.map((c) => (
                    <ClassCard key={c.id} data={c} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
      <CartBar />
    </div>
  );
}
