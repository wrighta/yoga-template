import type { Metadata } from "next";
import { all } from "@/db";
import { get } from "@/db";
import { Card, SectionHeading, Alert } from "@/components/ui";
import { fmtEuro } from "@/lib/money";
import { getSettings, isMultiDateDiscountActive } from "@/lib/settings";
import { getContentValue } from "@/lib/content";
import { ProductBuyForm } from "./product-buy-form";

export const metadata: Metadata = {
  title: "Prices & Memberships",
  description: "Simple pricing for yoga classes, term blocks, workshops and retreats in Lucan.",
  alternates: { canonical: "/prices" },
};

export default async function PricesPage() {
  const [settings, products, intro, multiDateActive] = await Promise.all([
    getSettings(),
    all<{ id: number; kind: string; name: string; description: string; price_cents: number; credits: number | null; validity_weeks: number | null; eligibility: string; recurrence: string | null; active: number }>(
      `SELECT * FROM products WHERE active = 1 ORDER BY sort ASC`
    ),
    getContentValue<string>("prices", "intro", "Simple, honest pricing."),
    isMultiDateDiscountActive(),
  ]);
  const rule = multiDateActive ? get<{ name: string; min_distinct_dates: number; max_distinct_dates: number; per_class_cents: number }>(
    `SELECT * FROM discount_rules WHERE kind = 'multi_date' AND active = 1 ORDER BY priority LIMIT 1`
  ) : undefined;
  const dropIn = products.find((p) => p.kind === "drop_in");
  const passes = settings.class_passes_enabled ? products.filter((p) => p.kind === "pass" && p.eligibility === "all") : [];
  const introPass = settings.class_passes_enabled ? products.find((p) => p.kind === "pass" && p.eligibility === "new_customer") : undefined;
  const memberships = settings.memberships_enabled ? products.filter((p) => p.kind === "membership") : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold text-forest-900 sm:text-5xl">Prices &amp; memberships</h1>
        <p className="mt-4 text-lg text-bark-700">{intro}</p>
      </div>

      {settings.tax_note ? <div className="mt-6"><Alert>{settings.tax_note}</Alert></div> : null}

      {/* How pricing works */}
      <section className="mt-10 grid gap-4 md:grid-cols-3" aria-label="How pricing works">
        <Card className="p-6">
          <h2 className="font-semibold text-forest-900">Drop in</h2>
          <p className="mt-1 font-display text-3xl font-semibold text-forest-900">{dropIn ? fmtEuro(dropIn.price_cents) : "€12"}</p>
          <p className="mt-2 text-sm text-bark-700">{multiDateActive
                ? "Any regular class, pay as you go. Perfect if you come occasionally."
                : "Any regular class, pay as you go. Book only the dates you want."}</p>
        </Card>
        {rule ? (
          <Card className="p-6 ring-2 ring-forest-700/40">
            <h2 className="font-semibold text-forest-900">{rule.name}</h2>
            <p className="mt-1 font-display text-3xl font-semibold text-forest-900">{fmtEuro(rule.per_class_cents)}</p>
            <p className="mt-2 text-sm text-bark-700">
              per class, when you book {rule.min_distinct_dates}–{rule.max_distinct_dates} different dates in one
              transaction. Applied automatically - no code needed.
            </p>
          </Card>
        ) : null}
        <Card className="p-6">
          <h2 className="font-semibold text-forest-900">Come every week?</h2>
          <p className="mt-2 text-sm text-bark-700">
            {memberships.length > 0 && settings.class_passes_enabled
              ? "A class pass or membership is cheaper per class - and the site shows the eligible options at checkout."
              : memberships.length > 0
                ? "A membership covers regular weekly classes while it's active."
              : settings.class_passes_enabled
                ? "A class pass is cheaper per class and can be used on separate dates."
                : "Blocks and bundles let you book a full term together at one price."}
          </p>
        </Card>
      </section>

      {/* Passes */}
      {settings.class_passes_enabled ? <section className="mt-14" aria-labelledby="passes">
        <SectionHeading eyebrow="Class passes" title="Credits that wait for you" sub="Use your credits on any regular class before the pass expires. They apply automatically when you book." />
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {passes.map((p) => (
            <Card key={p.id} className="flex flex-col p-6">
              <h3 className="text-lg font-semibold text-forest-900">{p.name}</h3>
              <p className="mt-1 font-display text-3xl font-semibold text-forest-900">{fmtEuro(p.price_cents)}</p>
              {p.credits ? (
                <p className="mt-1 text-sm font-semibold text-forest-700">
                  ≈ {fmtEuro(Math.round(p.price_cents / p.credits))} per class
                </p>
              ) : null}
              <p className="mt-3 flex-1 text-sm leading-relaxed text-bark-700">{p.description}</p>
              <p className="mt-2 text-xs text-bark-500">
                Valid {p.validity_weeks} weeks from purchase · credits return automatically if you cancel in time.
              </p>
              <div className="mt-4">
                <ProductBuyForm productId={p.id} name={p.name} isMembership={false} cta={`Buy ${p.name}`} />
              </div>
            </Card>
          ))}
        </div>
      </section> : null}

      {/* Intro pass */}
      {introPass && (
        <section className="mt-12" aria-labelledby="intro-pass">
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="max-w-xl">
                <p className="text-sm font-bold uppercase tracking-wider text-clay-700">First time with us?</p>
                <h2 id="intro-pass" className="mt-1 text-2xl font-semibold text-forest-900">{introPass.name} - {fmtEuro(introPass.price_cents)}</h2>
                <p className="mt-2 text-bark-700">{introPass.description}</p>
              </div>
              <div className="w-full max-w-xs">
                <ProductBuyForm productId={introPass.id} name={introPass.name} isMembership={false} cta="Get the intro pass" />
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* Memberships */}
      <section className="mt-14" aria-labelledby="memberships">
        <SectionHeading eyebrow="Memberships" title="For the once and twice a week crowd" sub="All regular weekly classes included while your membership is active." />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {memberships.map((m) => (
            <Card key={m.id} className="flex flex-col p-6">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-xl font-semibold text-forest-900">{m.name}</h3>
                <p className="font-display text-3xl font-semibold text-forest-900">{fmtEuro(m.price_cents)}</p>
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-bark-700">{m.description}</p>
              <p className="mt-3 rounded-xl bg-gold-200/40 px-4 py-2.5 text-xs font-medium text-gold-800">
                Renews {m.recurrence === "annual" ? "yearly" : "monthly"} · cancel any time before renewal · membership covers regular weekly classes only (separately priced workshops are excluded).
              </p>
              <div className="mt-4">
                <ProductBuyForm productId={m.id} name={m.name} isMembership cta={`Start ${m.name}`} />
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-12" aria-label="Fairness notes">
        <Card className="p-6 text-sm leading-relaxed text-bark-700">
          <h2 className="font-semibold text-forest-900">The small print, kept small</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            {settings.class_passes_enabled || settings.memberships_enabled ? <li>Passes and memberships cover regular weekly classes; separately priced workshops and events are not included unless stated.</li> : null}
            <li>Discounts don&apos;t stack - you always get the single best eligible price, and the checkout shows you exactly what was applied.</li>
            <li>Cancel a booking up to {settings.cancellation_cutoff_hours} hours before class for a refund or a returned pass credit.</li>
            <li>Prefer to pay in person? Book online and choose “pay at class”, or just message Anne.</li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
