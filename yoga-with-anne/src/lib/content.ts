import { all, run, get, nowIso } from "@/db";

export type ContentValue = string | string[] | Record<string, string>;

export async function getContent(page: string): Promise<Record<string, ContentValue>> {
  const rows = all<{ key: string; value: string }>(`SELECT key, value FROM content_blocks WHERE page = ?`, page);
  const out: Record<string, ContentValue> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

export async function getContentValue<T extends ContentValue>(page: string, key: string, fallback: T): Promise<T> {
  const row = get<{ value: string }>(`SELECT value FROM content_blocks WHERE page = ? AND key = ?`, page, key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setContent(page: string, key: string, value: ContentValue): Promise<void> {
  run(
    `INSERT INTO content_blocks (page, key, value, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(page, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    page,
    key,
    JSON.stringify(value),
    nowIso()
  );
}

export async function getPublishedFaqs(): Promise<{ id: number; question: string; answer: string }[]> {
  return all<{ id: number; question: string; answer: string }>(
    `SELECT id, question, answer FROM faqs WHERE published = 1 ORDER BY sort ASC, id ASC`
  );
}

export async function getPublishedTestimonials(): Promise<{ id: number; quote: string; attribution: string | null; consent_note: string | null }[]> {
  return all(
    `SELECT id, quote, attribution, consent_note FROM testimonials WHERE published = 1 ORDER BY sort ASC, id ASC`
  );
}

export async function getPublishedPolicy(slug: string): Promise<{ title: string; body_md: string; version: number; updated_at: string } | null> {
  return get(`SELECT title, body_md, version, updated_at FROM policies WHERE slug = ? AND status = 'published'`, slug) ?? null;
}
