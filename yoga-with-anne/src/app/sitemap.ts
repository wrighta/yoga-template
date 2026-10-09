import type { MetadataRoute } from "next";
import { all } from "@/db";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const settings = await getSettings();
  const staticPages = ["", "/classes", "/prices", "/about", "/faqs", "/contact"].map((p) => ({
    url: `${base}${p}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: p === "" ? 1 : 0.8,
  }));
  const policies = all<{ slug: string; updated_at: string }>(`SELECT slug, updated_at FROM policies WHERE status = 'published'`).map((p) => ({
    url: `${base}/policies/${p.slug}`,
    lastModified: new Date(p.updated_at),
    changeFrequency: "yearly" as const,
    priority: 0.3,
  }));
  const classes = all<{ id: number }>(
    `SELECT o.id FROM class_occurrences o LEFT JOIN class_series s ON s.id = o.series_id
     WHERE o.status = 'scheduled' AND o.publication_status = 'published'
       AND (o.series_id IS NULL OR (s.publication_status = 'published' AND s.status = 'active'))
       AND o.starts_at >= ? ORDER BY o.starts_at LIMIT 200`,
    new Date().toISOString()
  ).map((c) => ({
    url: `${base}/classes/${c.id}`,
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: 0.6,
  }));
  void settings;
  return [...staticPages, ...classes, ...policies];
}
