import Link from "next/link";
import type { Metadata } from "next";
import { ButtonLink, Card, SectionHeading, StateBadge } from "@/components/ui";
import { ClassCard, type ClassCardData } from "@/components/class-card";
import { listUpcoming } from "@/lib/schedule";
import { getContent, getPublishedFaqs, getPublishedTestimonials } from "@/lib/content";
import { getSettings, whatsappLink } from "@/lib/settings";
import { all } from "@/db";
import { fmtEuro } from "@/lib/money";
import { NewsletterForm } from "./newsletter-form";
import { listActiveServices } from "@/lib/services";
import { getMedia } from "@/lib/media";
import { getPrimaryVenue, isMultiDateDiscountActive } from "@/lib/settings";
import { getHomepageSections, type HomepageSectionId } from "@/lib/homepage";
import { appearanceCssFor, PALETTES } from "@/lib/appearance";
import { canAdminister, requireAdmin } from "@/lib/auth";
import { notFound } from "next/navigation";

type HomeSearchParams = { appearance_preview?: string; palette_id?: string; accent_color?: string };
type HeroButtonConfig = { label: string; href: string; active: boolean };

function heroButtonConfig(value: unknown, fallback: HeroButtonConfig): HeroButtonConfig {
  if (!value || typeof value !== "object") return fallback;
  const config = value as { label?: unknown; href?: unknown; active?: unknown };
  return {
    label: typeof config.label === "string" && config.label.trim() ? config.label : fallback.label,
    href: typeof config.href === "string" && config.href.startsWith("/") ? config.href : fallback.href,
    active: config.active !== "false",
  };
}

async function appearancePreviewAllowed(): Promise<boolean> {
  const admin = await requireAdmin();
  return !!admin && canAdminister(admin.role);
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<HomeSearchParams> }): Promise<Metadata> {
  const params = await searchParams;
  if (params.appearance_preview === "1") {
    return (await appearancePreviewAllowed())
      ? { title: "Homepage appearance preview", robots: { index: false, follow: false } }
      : { robots: { index: false, follow: false } };
  }
  return { alternates: { canonical: "/" } };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<HomeSearchParams> }) {
  const params = await searchParams;
  const appearancePreview = params.appearance_preview === "1";
  let previewCss: string | null = null;
  if (appearancePreview) {
    if (!(await appearancePreviewAllowed())) notFound();
    const paletteId = String(params.palette_id ?? "");
    if (!PALETTES.some((palette) => palette.id === paletteId)) notFound();
    const accent = params.accent_color && /^#[0-9a-fA-F]{6}$/.test(params.accent_color) ? params.accent_color : null;
    previewCss = appearanceCssFor(paletteId, accent);
  }
  const [settings, classes, content, faqs, testimonials, products, homepageSections] = await Promise.all([
    getSettings(),
    listUpcoming(6),
    getContent("home"),
    getPublishedFaqs(),
    getPublishedTestimonials(),
    all<{ id: number; kind: string; name: string; description: string; price_cents: number; credits: number | null; validity_weeks: number | null; eligibility: string; recurrence: string | null }>(
      `SELECT * FROM products WHERE active = 1 ORDER BY sort ASC`
    ),
    getHomepageSections(),
  ]);
  const heroPhoto = settings.hero_media_id ? getMedia(settings.hero_media_id) : null;
  const portraitPhoto = settings.portrait_media_id ? getMedia(settings.portrait_media_id) : null;
  const [venue, multiDateActive, services] = await Promise.all([getPrimaryVenue(), isMultiDateDiscountActive(), listActiveServices()]);
  const whatToExpect = content.what_to_expect as unknown as { intro: string; items: string[][] } | undefined;
  const whoSuits = content.who_suits as unknown as { intro: string; items: string[][] } | undefined;
  const servicesHeading = String(content.services_heading ?? "Explore classes and experiences");
  const servicesSub = String(content.services_sub ?? "Find the class or experience that feels right for you.");
  const primaryHeroButton = heroButtonConfig(content.hero_primary_button, { label: "View classes & book", href: "/classes", active: true });
  const secondaryHeroButton = heroButtonConfig(content.hero_secondary_button, { label: "New to yoga? Start here", href: "/#new-here", active: true });
  const passes = settings.class_passes_enabled ? products.filter((p) => p.kind === "pass" && p.eligibility === "all") : [];
  const dropIn = products.find((p) => p.kind === "drop_in");
  const homepageLayout = new Map(homepageSections.map((section) => [section.id, section]));
  const sectionVisible = (id: HomepageSectionId) => homepageLayout.get(id)?.active ?? true;
  const sectionOrder = (id: HomepageSectionId) => homepageLayout.get(id)?.sort ?? 1;

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

  const seriesRows = all<{ weekdays: string; start_time: string; end_time: string }>(
    `SELECT weekdays, start_time, end_time FROM class_series WHERE status = 'active' AND publication_status = 'published'`
  );
  const dayMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const openingHours = seriesRows.flatMap((sr) => {
    const days = (JSON.parse(sr.weekdays) as number[]).map((d) => dayMap[d % 7]);
    return [{
      "@type": "OpeningHoursSpecification",
      dayOfWeek: days,
      opens: sr.start_time,
      closes: sr.end_time,
    }];
  });
  const localBusinessJsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: settings.business_name,
    description: "Gentle yoga and meditation classes in Lucan, Co. Dublin - all levels, especially beginners and over-60s.",
    ...(venue
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: venue.address ?? undefined,
            addressLocality: "Lucan",
            addressRegion: "Co. Dublin",
            postalCode: venue.postcode ?? undefined,
            addressCountry: "IE",
          },
          telephone: settings.contact_phone_display,
          email: settings.contact_email,
          ...(venue.map_url ? { hasMap: venue.map_url } : {}),
        }
      : {}),
    priceRange: "€€",
    ...(openingHours.length ? { openingHoursSpecification: openingHours } : {}),
  };

  return (
    <>
      {previewCss ? <style data-appearance-preview dangerouslySetInnerHTML={{ __html: previewCss }} /> : null}
      {appearancePreview ? <div role="status" className="border-b border-gold-200 bg-gold-100 px-4 py-2 text-center text-sm font-semibold text-gold-800">Unsaved theme preview · live colours have not changed.</div> : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }} />
      <div className="flex flex-col">
      {/* Hero */}
      {sectionVisible("hero") && <section className="relative overflow-hidden" style={{ order: sectionOrder("hero") }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <svg className="hero-blob absolute -right-24 -top-24 h-[480px] w-[480px] text-sage-200" viewBox="0 0 200 200">
            <path fill="currentColor" d="M45.9,-63.9C58.9,-55.4,68.4,-41.5,73.6,-25.9C78.8,-10.3,79.6,7,73.7,21.5C67.8,36,55.1,47.7,40.9,56.1C26.7,64.5,10.9,69.6,-4.5,70.9C-19.9,72.2,-35,69.8,-46.9,61.1C-58.8,52.4,-67.5,37.5,-71.2,21.3C-74.9,5.1,-73.7,-12.4,-66.4,-26.4C-59.1,-40.4,-45.7,-50.9,-31.7,-58.9C-17.7,-66.9,-3.1,-72.4,11.2,-70.7C25.5,-69,32.9,-72.4,45.9,-63.9Z" transform="translate(100 100)" />
          </svg>
          <svg className="hero-blob absolute -bottom-32 -left-32 h-[380px] w-[380px] text-clay-100" viewBox="0 0 200 200">
            <path fill="currentColor" d="M42.7,-57.2C55.8,-49.8,67.1,-37.5,71.6,-22.9C76.1,-8.3,73.9,8.7,67.2,23.3C60.5,37.9,49.4,50,35.9,58.4C22.4,66.8,6.5,71.5,-9.1,71.2C-24.7,70.9,-40,65.6,-51.5,55.3C-63,45,-70.7,29.7,-72.7,13.5C-74.7,-2.7,-71,-19.8,-61.9,-32.5C-52.8,-45.2,-38.3,-53.5,-24.3,-59.3C-10.3,-65.1,3.2,-68.4,17.4,-67.9C31.6,-67.4,29.6,-64.6,42.7,-57.2Z" transform="translate(100 100)" />
          </svg>
        </div>
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:pb-24 lg:pt-20">
          {heroPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/media/${heroPhoto.id}`}
              alt={heroPhoto.alt || "A yoga class in progress"}
              width={800}
              height={520}
              className="mb-2 aspect-[16/10] w-full rounded-[1.6rem] border border-oat-200 object-cover shadow-[0_16px_40px_-24px_rgba(30,50,40,0.45)] lg:hidden"
            />
          ) : null}
          <div>
            <h1 className="text-4xl font-semibold leading-tight text-forest-900 sm:text-5xl lg:text-6xl">
              {String(content.hero_heading ?? "Gentle yoga & meditation in Lucan")}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-bark-700 sm:text-xl">
              {String(content.hero_sub ?? "Move at your own pace and feel welcome from your very first class.")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {primaryHeroButton.active ? <ButtonLink href={primaryHeroButton.href}>{primaryHeroButton.label}</ButtonLink> : null}
              {secondaryHeroButton.active ? <ButtonLink href={secondaryHeroButton.href} variant="secondary">{secondaryHeroButton.label}</ButtonLink> : null}
            </div>
          </div>
          <div className="relative hidden lg:block">
            {heroPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/media/${heroPhoto.id}`}
                alt={heroPhoto.alt || "A yoga class in progress"}
                width={480}
                height={480}
                className="mx-auto aspect-square w-full max-w-sm rounded-[2rem] border border-oat-200 object-cover shadow-[0_16px_40px_-24px_rgba(30,50,40,0.45)]"
              />
            ) : (
            <svg viewBox="0 0 420 420" role="img" aria-label="Illustration of a seated meditation posture" className="mx-auto w-full max-w-sm">
              <circle cx="210" cy="210" r="200" fill="var(--t100)" />
              <circle cx="210" cy="160" r="58" fill="var(--b800)" />
              <path d="M100 320 Q 210 240 320 320 L 320 340 Q 210 280 100 340 Z" fill="var(--b800)" />
              <path d="M150 300 Q 210 268 270 300 Q 240 316 210 316 Q 180 316 150 300Z" fill="var(--a600)" opacity="0.9" />
              <path d="M130 180 Q 90 230 120 280" stroke="var(--b700)" strokeWidth="14" fill="none" strokeLinecap="round" />
              <path d="M290 180 Q 330 230 300 280" stroke="var(--b700)" strokeWidth="14" fill="none" strokeLinecap="round" />
              <path d="M210 80 Q 150 120 130 180" stroke="var(--b800)" strokeWidth="12" fill="none" strokeLinecap="round" />
              <path d="M210 80 Q 270 120 290 180" stroke="var(--b800)" strokeWidth="12" fill="none" strokeLinecap="round" />
              <circle cx="210" cy="46" r="22" fill="var(--a500)" opacity="0.85" />
            </svg>
            )}
          </div>
        </div>
      </section>}

      {/* Services */}
      {sectionVisible("services") && services.length > 0 && (
        <section className="bg-sage-100 py-14 sm:py-16" aria-labelledby="services-heading" style={{ order: sectionOrder("services") }}>
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <p className="mb-2 text-sm font-bold uppercase tracking-wider text-clay-700">Classes &amp; experiences</p>
            <h2 id="services-heading" className="text-3xl font-semibold text-forest-900">{servicesHeading}</h2>
            <p className="mt-3 text-lg text-bark-700">{servicesSub}</p>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {services.map((svc) => {
              const img = svc.image_media_id ? getMedia(svc.image_media_id) : null;
              return (
                <Link
                  key={svc.id}
                  href={svc.link}
                  className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-oat-200 bg-white transition hover:shadow-[0_12px_32px_-16px_rgba(30,50,40,0.35)]"
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${img.id}`} alt={img.alt || svc.name} className="h-44 w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="h-44 w-full bg-sage-100" aria-hidden="true" />
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-6">
                    <h2 className="text-xl font-semibold text-forest-900">{svc.name}</h2>
                    {svc.description ? <p className="text-sm leading-relaxed text-bark-700">{svc.description}</p> : null}
                    <span className="mt-auto pt-2 text-sm font-semibold text-forest-800 underline underline-offset-4 group-hover:text-forest-600">
                      Find out more →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
          </div>
        </section>
      )}

      {/* Next classes */}
      {sectionVisible("classes") && <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6" aria-labelledby="next-classes" style={{ order: sectionOrder("classes") }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading eyebrow="Coming up" title="Next available classes" />
          <Link href="/classes" className="text-sm font-semibold text-forest-800 underline underline-offset-4">
            See the full schedule →
          </Link>
        </div>
        {cardData.length === 0 ? (
          <div className="mt-8 rounded-[var(--radius-card)] border border-oat-200 bg-white p-8 text-center sm:p-10">
            <p className="text-lg font-medium text-bark-800">
              {settings.no_classes_notice || "No classes currently scheduled."}
            </p>
            <p className="mt-2 text-sm text-bark-500">
              {settings.no_classes_notice ? "Check back soon, or get in touch below if you have any questions." : "New dates are added regularly - message Anne on WhatsApp or check back soon."}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <a
                href={whatsappLink(settings)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white hover:bg-forest-900"
              >
                Message on WhatsApp
              </a>
              <Link
                href="/contact"
                className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-forest-800/20 bg-white px-6 py-2.5 text-sm font-semibold text-forest-900 hover:bg-forest-50"
              >
                Contact Anne
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cardData.slice(0, 6).map((c) => (
              <ClassCard key={c.id} data={c} />
            ))}
          </div>
        )}
      </section>}

      {/* What to expect */}
      {sectionVisible("expect") && <section className="bg-white py-16" aria-labelledby="expect" style={{ order: sectionOrder("expect") }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="What to expect" title={whatToExpect?.intro ?? "A calm hour, from welcome to winding down"} />
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {(whatToExpect?.items ?? []).map(([title, body], index) => (
              <div key={index} className="rounded-[var(--radius-card)] border border-oat-200 bg-oat-50 p-6">
                <h3 className="text-lg font-semibold text-forest-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-bark-500">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>}

      {/* Who it suits */}
      {sectionVisible("suits") && <section id="new-here" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6" aria-labelledby="suits" style={{ order: sectionOrder("suits") }}>
        <SectionHeading eyebrow="Who the classes suit" title={whoSuits?.intro ?? "Real classes for real bodies"} />
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {(whoSuits?.items ?? []).map(([title, body], i) => (
            <Card key={i} className="p-6">
              <h3 className="flex items-center gap-3 text-lg font-semibold text-forest-900">
                <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0 text-clay-700">
                  <circle cx="11" cy="11" r="10" fill="currentColor" opacity="0.15" />
                  <path d="M6.5 11.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {title}
              </h3>
              <p className="mt-2 leading-relaxed text-bark-700">{body}</p>
            </Card>
          ))}
        </div>
      </section>}

      {/* Pricing preview */}
      {sectionVisible("pricing") && <section className="bg-forest-900 py-16 text-white" aria-labelledby="pricing-preview" style={{ order: sectionOrder("pricing") }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="mb-2 text-sm font-bold uppercase tracking-wider text-sage-300">Simple pricing</p>
          <h2 id="pricing-preview" className="max-w-2xl font-display text-3xl font-semibold sm:text-4xl">
            {settings.multi_date_discount_enabled || settings.class_passes_enabled
              ? "Pay your way - the site always finds you the best eligible price"
              : "Choose a class or book a full block together"}
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <div className="rounded-[var(--radius-card)] bg-white/5 p-6 ring-1 ring-white/10">
              <h3 className="text-lg font-semibold">Drop in</h3>
              <p className="mt-2 font-display text-3xl font-semibold">{dropIn ? fmtEuro(dropIn.price_cents) : "€12"}<span className="text-base font-normal text-sage-300"> / class</span></p>
              <p className="mt-3 text-sm text-sage-200">{multiDateActive ? "Pay per class, no commitment. Book 2–4 dates in one go and each class is less." : "Pay per class, no commitment - book only the dates you want."}</p>
            </div>
            {passes.slice(0, 2).map((p) => (
              <div key={p.id} className="rounded-[var(--radius-card)] bg-white/5 p-6 ring-1 ring-white/10">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="mt-2 font-display text-3xl font-semibold">{fmtEuro(p.price_cents)}</p>
                <p className="mt-3 text-sm text-sage-200">{p.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <ButtonLink href="/prices" variant="clay">See all prices &amp; memberships</ButtonLink>
          </div>
        </div>
      </section>}

      {/* Meet Anne */}
      {sectionVisible("meet") && <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="meet" style={{ order: sectionOrder("meet") }}>
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="relative">
            {portraitPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/media/${portraitPhoto.id}`}
                alt={portraitPhoto.alt || "Anne Wright"}
                width={480}
                height={576}
                className="mx-auto aspect-[5/6] w-full max-w-xs rounded-[var(--radius-card)] border border-oat-200 object-cover"
              />
            ) : (
            <svg viewBox="0 0 300 360" role="img" aria-label="Decorative illustration - portrait placeholder" className="mx-auto w-full max-w-xs rounded-[var(--radius-card)]">
              <rect width="300" height="360" rx="18" fill="var(--t100)" />
              <circle cx="150" cy="130" r="52" fill="var(--b800)" />
              <path d="M60 320 Q 150 220 240 320 L 240 360 L 60 360 Z" fill="var(--b800)" />
              <path d="M40 90 Q 150 30 260 90" stroke="var(--a500)" strokeWidth="6" fill="none" strokeLinecap="round" />
            </svg>
            )}
          </div>
          <div>
            <SectionHeading eyebrow="Meet Anne" title="A teacher who meets you where you are" />
            <p className="mt-4 max-w-xl leading-relaxed text-bark-700">
              Anne Wright teaches gentle yoga and meditation in Lucan. Her classes are friendly and practical - real movement for real bodies, with plenty of options so everyone can take part.
            </p>
            <div className="mt-6">
              <ButtonLink href="/about" variant="secondary">Read about Anne&apos;s approach</ButtonLink>
            </div>
          </div>
        </div>
      </section>}

      {/* Venue */}
      {sectionVisible("venue") && <section className="bg-white py-16" aria-labelledby="venue" style={{ order: sectionOrder("venue") }}>
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="The venue" title={venue?.name ?? "Our Lucan venue"} />
            {venue?.address ? (
              <p className="mt-4 leading-relaxed text-bark-700">
                {venue.address}{venue.postcode ? `, ${venue.postcode}` : ""}
              </p>
            ) : null}
            {venue?.directions ? <p className="mt-2 text-sm text-bark-700">{venue.directions}</p> : null}
            <ul className="mt-4 space-y-2 text-sm text-bark-700">
              {venue?.parking_notes ? (
                <li className="flex gap-2"><span aria-hidden="true" className="text-forest-700">✓</span> {venue.parking_notes}</li>
              ) : null}
              {venue?.access_notes ? (
                <li className="flex gap-2"><span aria-hidden="true" className="text-forest-700">✓</span> {venue.access_notes}</li>
              ) : null}
            </ul>
            <div className="mt-6 flex flex-wrap gap-4">
              {venue?.map_url ? <ButtonLink href={venue.map_url} variant="secondary" target="_blank" rel="noopener noreferrer">Open in Google Maps</ButtonLink> : null}
              <ButtonLink href="/contact">Contact &amp; directions</ButtonLink>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-4 rounded-[var(--radius-card)] border border-oat-200 bg-white p-8">
            <p className="font-display text-xl font-semibold text-forest-900">{venue?.name ?? "Our Lucan venue"}</p>
            <p className="text-sm leading-relaxed text-bark-700">
              {venue?.address ?? "Venue details are managed by Anne."}
              {venue?.postcode ? (<><br />{venue.postcode}</>) : null}
            </p>
            {venue?.map_url ? (
              <ButtonLink href={venue.map_url} variant="secondary" target="_blank" rel="noopener noreferrer">Open in Google Maps</ButtonLink>
            ) : null}
          </div>
        </div>
      </section>}

      {/* Testimonials (only if genuine, published ones exist) */}
      {sectionVisible("testimonials") && testimonials.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="testimonials" style={{ order: sectionOrder("testimonials") }}>
          <SectionHeading eyebrow="Kind words" title="What students say" />
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {testimonials.slice(0, 3).map((t) => (
              <Card key={t.id} className="p-6">
                <blockquote>
                  <p className="text-bark-700">&ldquo;{t.quote}&rdquo;</p>
                  <footer className="mt-4 text-sm font-semibold text-forest-800">
                    {t.attribution}
                    {t.consent_note ? <span className="block text-xs font-normal text-bark-500">{t.consent_note}</span> : null}
                  </footer>
                </blockquote>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* FAQ preview */}
      {sectionVisible("faqs") && <section className="bg-oat-100 py-16" aria-labelledby="faq-preview" style={{ order: sectionOrder("faqs") }}>
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <SectionHeading eyebrow="Good to know" title="Questions people ask" />
          <div className="mt-8 space-y-3">
            {faqs.slice(0, 4).map((f) => (
              <details key={f.id} className="group rounded-[var(--radius-card)] border border-oat-200 bg-white p-5 open:ring-1 open:ring-forest-700/30">
                <summary className="cursor-pointer list-none text-lg font-semibold text-forest-900 marker:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {f.question}
                    <span aria-hidden="true" className="text-clay-700 transition group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-bark-700">{f.answer}</p>
              </details>
            ))}
          </div>
          <div className="mt-8">
            <ButtonLink href="/faqs" variant="secondary">All questions</ButtonLink>
          </div>
        </div>
      </section>}

      {/* Newsletter */}
      {sectionVisible("newsletter") && <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6" aria-labelledby="newsletter" style={{ order: sectionOrder("newsletter") }}>
        <Card className="p-8 text-center sm:p-10">
          <h2 id="newsletter" className="font-display text-2xl font-semibold text-forest-900 sm:text-3xl">Occasional news, never spam</h2>
          <p className="mx-auto mt-3 max-w-md text-bark-700">
            Term dates, schedule changes and the odd gentle nudge to breathe. One or two emails a month at most.
          </p>
          <NewsletterForm />
        </Card>
      </section>}
      </div>
    </>
  );
}
