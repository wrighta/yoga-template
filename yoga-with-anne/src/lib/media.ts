import { get, all, run, nowIso } from "@/db";

export type MediaRow = {
  id: number;
  filename: string | null;
  mime: string;
  size: number;
  alt: string;
  created_at: string;
};

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MiB after client-side downscaling
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];

/** Sniff the real image type from magic bytes - never trust the browser-supplied MIME. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function validateImageUpload(bytes: Uint8Array, declaredSize: number): { ok: true; mime: string } | { ok: false; error: string } {
  if (declaredSize <= 0) return { ok: false, error: "The file appears to be empty." };
  if (declaredSize > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Images must be 4 MB or smaller after resizing - please choose a smaller photo." };
  }
  const mime = sniffImageMime(bytes);
  if (!mime || !ALLOWED_MIMES.includes(mime)) {
    return { ok: false, error: "Only JPEG, PNG or WebP images are supported." };
  }
  return { ok: true, mime };
}

export function safeFilename(name: string | null | undefined): string {
  const base = (name ?? "image").split(/[\\/]/).pop() ?? "image";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "image";
}

export function insertMedia(bytes: Uint8Array, mime: string, filename: string, alt: string): number {
  const res = run(
    `INSERT INTO media (filename, mime, bytes, size, alt, created_at) VALUES (?,?,?,?,?,?)`,
    safeFilename(filename),
    mime,
    bytes,
    bytes.byteLength,
    alt.slice(0, 300),
    nowIso()
  );
  return Number(res.lastInsertRowid);
}

export function getMedia(id: number): MediaRow | undefined {
  return get<MediaRow>(`SELECT id, filename, mime, size, alt, created_at FROM media WHERE id = ?`, id);
}

export function getMediaBytes(id: number): { mime: string; bytes: Uint8Array; filename: string | null } | undefined {
  return get<{ mime: string; bytes: Uint8Array; filename: string | null }>(
    `SELECT mime, bytes, filename FROM media WHERE id = ?`,
    id
  );
}

export function listMedia(): MediaRow[] {
  return all<MediaRow>(`SELECT id, filename, mime, size, alt, created_at FROM media ORDER BY id DESC LIMIT 200`);
}

export function updateMediaAlt(id: number, alt: string): void {
  run(`UPDATE media SET alt = ? WHERE id = ?`, alt.slice(0, 300), id);
}

/** Where is this image referenced? Used to make deletion safe. */
export function mediaReferences(id: number): string[] {
  const refs: string[] = [];
  const settingsKeys = [
    ["logo_media_id", "site logo (Settings)"],
    ["hero_media_id", "homepage hero image (Settings)"],
    ["portrait_media_id", "Anne's portrait (Settings)"],
    ["og_media_id", "social sharing image (Settings)"],
  ] as const;
  for (const [key, label] of settingsKeys) {
    const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, key);
    if (row && JSON.parse(row.value) === id) refs.push(label);
  }
  if (get(`SELECT id FROM class_types WHERE image_media_id = ?`, id)) refs.push("a class type image");
  return refs;
}

export function deleteMedia(id: number): { ok: boolean; error?: string } {
  const refs = mediaReferences(id);
  if (refs.length > 0) {
    return { ok: false, error: `This image is still used by ${refs.join(", ")}. Remove it there first, then delete.` };
  }
  run(`DELETE FROM media WHERE id = ?`, id);
  return { ok: true };
}

export function mediaUrl(id: number | null | undefined): string | null {
  return id ? `/api/media/${id}` : null;
}
