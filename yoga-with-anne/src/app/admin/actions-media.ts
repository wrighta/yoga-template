"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/db";
import { requireAdmin, canWrite, canAdminister } from "@/lib/auth";
import { insertMedia, updateMediaAlt, deleteMedia, validateImageUpload, listMedia } from "@/lib/media";

export async function uploadMediaAction(_prev: { ok: boolean; message: string } | null, formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Please sign in again." };
  if (!canWrite(admin.role)) return { ok: false, message: "Your role has read-only access." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return { ok: false, message: "Choose an image to upload first." };

  const alt = String(formData.get("alt") ?? "").trim();
  let uploaded = 0;
  const errors: string[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validateImageUpload(bytes, bytes.byteLength);
    if (!check.ok) {
      errors.push(`${file.name}: ${check.error}`);
      continue;
    }
    insertMedia(bytes, check.mime, file.name, alt || file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "));
    uploaded++;
  }
  if (uploaded > 0) {
    audit("media.uploaded", { actorType: "admin", actor: admin.email, detail: { count: uploaded } });
    revalidatePath("/admin/media");
  }
  if (errors.length > 0) {
    return { ok: uploaded > 0, message: `${uploaded} image${uploaded === 1 ? "" : "s"} uploaded. Problems: ${errors.join(" ")}` };
  }
  return { ok: true, message: `${uploaded} image${uploaded === 1 ? "" : "s"} uploaded.` };
}

export async function uploadMediaInlineAction(formData: FormData): Promise<{ ok: boolean; message: string; media?: { id: number; alt: string; mime: string } }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Please sign in again." };
  if (!canWrite(admin.role)) return { ok: false, message: "Your role has read-only access." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a photo first." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateImageUpload(bytes, bytes.byteLength);
  if (!validation.ok) return { ok: false, message: validation.error };
  const alt = String(formData.get("alt") ?? "").trim() || file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
  const id = insertMedia(bytes, validation.mime, file.name, alt);
  audit("media.uploaded_inline", { actorType: "admin", actor: admin.email, entityType: "media", entityId: id });
  revalidatePath("/admin/media");
  revalidatePath("/admin/content");
  revalidatePath("/admin/classes/new");
  return { ok: true, message: "Photo uploaded and selected.", media: { id, alt, mime: validation.mime } };
}

export async function updateMediaAltAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin || !canAdminister(admin.role)) return;
  const id = Number(formData.get("id"));
  const alt = String(formData.get("alt") ?? "");
  updateMediaAlt(id, alt);
  audit("media.alt_updated", { actorType: "admin", actor: admin.email, entityType: "media", entityId: id });
  revalidatePath("/admin/media");
}

export async function deleteMediaAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin || !canAdminister(admin.role)) return;
  const id = Number(formData.get("id"));
  const res = deleteMedia(id);
  audit(res.ok ? "media.deleted" : "media.delete_blocked", {
    actorType: "admin",
    actor: admin.email,
    entityType: "media",
    entityId: id,
    detail: res.ok ? undefined : { reason: res.error },
  });
  revalidatePath("/admin/media");
}

export async function mediaCount(): Promise<number> {
  return listMedia().length;
}
