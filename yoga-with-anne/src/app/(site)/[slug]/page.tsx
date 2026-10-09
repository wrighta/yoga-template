import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canAdminister, requireAdmin } from "@/lib/auth";
import { getPublishedSitePage, getSitePageBySlug } from "@/lib/site-pages";
import { getMedia } from "@/lib/media";

export const dynamic = "force-dynamic";

async function canPreviewPages(): Promise<boolean> {
  const admin = await requireAdmin();
  return !!admin && canAdminister(admin.role);
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const preview = (await searchParams).preview === "1";
  if (preview && !(await canPreviewPages())) return { title: "Page not found", robots: { index: false, follow: false } };
  const page = preview ? getSitePageBySlug(slug) : getPublishedSitePage(slug);
  if (!page) return { title: "Page not found", robots: preview ? { index: false, follow: false } : undefined };
  if (preview) return { title: `${page.title} (Preview)`, description: page.intro ?? undefined, robots: { index: false, follow: false } };
  return { title: page.title, description: page.intro ?? undefined, alternates: { canonical: `/${page.slug}` } };
}

export default async function SitePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { slug } = await params;
  const preview = (await searchParams).preview === "1";
  if (preview && !(await canPreviewPages())) notFound();
  const page = preview ? getSitePageBySlug(slug) : getPublishedSitePage(slug);
  if (!page) notFound();
  const hero = page.hero_media_id ? getMedia(page.hero_media_id) : null;

  return (
    <>
    {preview ? <div role="status" className="border-b border-gold-200 bg-gold-100 px-4 py-2 text-center text-sm font-semibold text-gold-800">Preview only · This page is not visible to visitors until published.</div> : null}
    <article className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="max-w-3xl">
        <h1 className="text-4xl font-semibold text-forest-900 sm:text-5xl">{page.title}</h1>
        {page.intro ? <p className="mt-4 text-lg leading-relaxed text-bark-700">{page.intro}</p> : null}
        {hero ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/media/${hero.id}`} alt={hero.alt || page.title} className="mt-8 max-h-[28rem] w-full rounded-[var(--radius-card)] object-cover" />
        ) : null}
      </header>
      <div className="mt-10 space-y-8">
        {page.sections.map((section, index) => {
          const image = section.imageMediaId ? getMedia(section.imageMediaId) : null;
          return (
            <section key={`${page.id}-${index}`} className="grid gap-6 border-t border-oat-200 pt-8 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)]">
              <div>
                {section.heading ? <h2 className="text-2xl font-semibold text-forest-900">{section.heading}</h2> : null}
                {section.body ? <p className="mt-3 whitespace-pre-line leading-relaxed text-bark-700">{section.body}</p> : null}
                {section.buttonLabel && section.buttonHref ? (
                  <Link href={section.buttonHref} className="mt-5 inline-flex min-h-[44px] items-center rounded-full bg-forest-800 px-5 py-2.5 font-semibold text-white hover:bg-forest-900">{section.buttonLabel}</Link>
                ) : null}
              </div>
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${image.id}`} alt={image.alt || section.heading || page.title} className="max-h-72 w-full rounded-[var(--radius-card)] object-cover" loading="lazy" />
              ) : null}
            </section>
          );
        })}
      </div>
    </article>
    </>
  );
}
