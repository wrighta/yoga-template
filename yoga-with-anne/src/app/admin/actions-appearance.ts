"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit } from "@/db";
import { requireAdmin, canAdminister } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { PALETTES } from "@/lib/appearance";

export async function saveAppearanceAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAdminister(admin.role)) redirect("/admin?error=Only+a+Super+Admin+can+change+appearance");

  const paletteId = String(formData.get("palette_id") ?? "");
  if (!PALETTES.some((p) => p.id === paletteId)) {
    redirect("/admin/appearance?error=Unknown+palette");
  }
  const clearAccent = formData.get("clear_accent") === "1";
  const accentRaw = String(formData.get("accent_color") ?? "").trim();
  const accent = clearAccent ? null : /^#[0-9a-fA-F]{6}$/.test(accentRaw) ? accentRaw.toLowerCase() : null;

  await setSetting("palette_id", paletteId);
  await setSetting("accent_color", accent);
  audit("appearance.updated", { actorType: "admin", actor: admin.email, detail: { paletteId, accent } });
  revalidatePath("/", "layout");
  redirect("/admin/appearance?saved=1");
}
