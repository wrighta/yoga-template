import { get } from "@/db";

export type SitePageSection = {
  heading?: string;
  body?: string;
  imageMediaId?: number | null;
  buttonLabel?: string;
  buttonHref?: string;
};

export type SitePage = {
  id: number;
  slug: string;
  title: string;
  intro: string | null;
  hero_media_id: number | null;
  sections: SitePageSection[];
};

type SitePageRow = { id: number; slug: string; title: string; intro: string | null; hero_media_id: number | null; sections_json: string };

function toSitePage(row: SitePageRow): SitePage {
  let sections: SitePageSection[] = [];
  try {
    const parsed: unknown = JSON.parse(row.sections_json);
    if (Array.isArray(parsed)) {
      sections = parsed.filter((section): section is SitePageSection => typeof section === "object" && section !== null);
    }
  } catch {
    sections = [];
  }
  return { id: row.id, slug: row.slug, title: row.title, intro: row.intro, hero_media_id: row.hero_media_id, sections };
}

export function getPublishedSitePage(slug: string): SitePage | null {
  const row = get<SitePageRow>(
    `SELECT id, slug, title, intro, hero_media_id, sections_json FROM site_pages WHERE slug = ? AND status = 'published'`,
    slug
  );
  return row ? toSitePage(row) : null;
}

export function getSitePageBySlug(slug: string): SitePage | null {
  const row = get<SitePageRow>(
    `SELECT id, slug, title, intro, hero_media_id, sections_json FROM site_pages WHERE slug = ?`,
    slug
  );
  return row ? toSitePage(row) : null;
}
