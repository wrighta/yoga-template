"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { run, get, nowIso, audit } from "@/db";
import { requireAdmin, canAdminister } from "@/lib/auth";
import { setSetting } from "@/lib/settings";

async function guardSuper() {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAdminister(admin.role)) redirect("/admin?error=Only+the+super+admin+can+do+that");
  return admin;
}

/** Homepage service modules (super admin). */
export async function saveServiceAction(formData: FormData) {
  const admin = await guardSuper();
  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim();
  const link = String(formData.get("link") ?? "").trim() || "/classes";
  const description = String(formData.get("description") ?? "").trim() || null;
  const imageRaw = String(formData.get("imageMediaId") ?? "").trim();
  const image = imageRaw === "" ? null : Number(imageRaw) || null;
  const sort = Number(formData.get("sort") ?? 0) || 0;
  const active = formData.get("active") === "on" ? 1 : 0;
  if (!name) redirect("/admin/content?error=Service+needs+a+name");
  const fixedLinks = new Set(["/classes", "/workshops", "/enquire", "/prices", "/contact"]);
  if (!fixedLinks.has(link)) {
    const customPage = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(link);
    if (!customPage || !get(`SELECT id FROM site_pages WHERE slug = ? AND status = 'published'`, customPage[1])) {
      redirect("/admin/content?error=Choose+a+published+page+for+this+service+link");
    }
  }
  if (id) {
    run(`UPDATE services SET name=?, description=?, image_media_id=?, link=?, sort=?, active=?, updated_at=? WHERE id=?`,
      name, description, image, link, sort, active, nowIso(), id);
    audit("service.updated", { actorType: "admin", actor: admin.email, entityType: "service", entityId: id });
  } else {
    const res = run(`INSERT INTO services (name, description, image_media_id, link, sort, active) VALUES (?,?,?,?,?,?)`,
      name, description, image, link, sort, active);
    audit("service.created", { actorType: "admin", actor: admin.email, entityType: "service", entityId: Number(res.lastInsertRowid) });
  }
  revalidatePath("/");
  revalidatePath("/admin/content");
  redirect("/admin/content?saved=services");
}

export async function deleteServiceAction(formData: FormData) {
  const admin = await guardSuper();
  run(`DELETE FROM services WHERE id = ?`, Number(formData.get("id")));
  audit("service.deleted", { actorType: "admin", actor: admin.email, entityType: "service", entityId: Number(formData.get("id")) });
  revalidatePath("/");
  revalidatePath("/admin/content");
}

/** Team management (super admin only): create teacher admin accounts. */
export async function createTeamMemberAction(formData: FormData) {
  const admin = await guardSuper();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "teacher_owner") === "super_admin" ? "super_admin" : "teacher_owner";
  if (!email.includes("@") || !name || password.length < 8) {
    redirect("/admin/settings?error=Team+member+needs+a+name,+email+and+a+password+of+8+or+more+characters");
  }
  const dupe = get(`SELECT id FROM admins WHERE email = ?`, email);
  if (dupe) redirect("/admin/settings?error=That+email+already+has+an+account");
  const { hashPassword } = await import("@/lib/auth");
  run(`INSERT INTO admins (email, name, role, password_hash) VALUES (?,?,?,?)`, email, name, role, hashPassword(password));
  audit("team.member_created", { actorType: "admin", actor: admin.email, entityType: "admin", entityId: email, detail: { role } });
  revalidatePath("/admin/settings");
  redirect("/admin/settings?team=1");
}

export async function deleteTeamMemberAction(formData: FormData) {
  const admin = await guardSuper();
  const id = Number(formData.get("id"));
  if (id === admin.id) redirect("/admin/settings?error=You+cannot+remove+your+own+account");
  const target = get<{ role: string }>(`SELECT role FROM admins WHERE id = ?`, id);
  if (!target) redirect("/admin/settings");
  if (canAdminister(target.role as Parameters<typeof canAdminister>[0])) {
    const superAdmins = get<{ count: number }>(`SELECT COUNT(*) AS count FROM admins WHERE role IN ('super_admin','owner','admin')`)!.count;
    if (superAdmins <= 1) redirect("/admin/settings?error=Create+another+Super+Admin+before+removing+this+account");
  }
  run(`DELETE FROM admins WHERE id = ?`, id);
  audit("team.member_removed", { actorType: "admin", actor: admin.email, entityType: "admin", entityId: id, detail: { role: target.role } });
  revalidatePath("/admin/settings");
  redirect("/admin/settings?team=removed");
}

export async function updateTeamMemberRoleAction(formData: FormData) {
  const admin = await guardSuper();
  const id = Number(formData.get("id"));
  const requestedRole = String(formData.get("role") ?? "teacher_owner");
  const role = requestedRole === "super_admin" ? "super_admin" : "teacher_owner";
  if (!Number.isInteger(id) || id <= 0) redirect("/admin/settings?error=Choose+a+team+member");
  if (id === admin.id) redirect("/admin/settings?error=Use+another+Super+Admin+account+to+change+your+role");
  const target = get<{ role: string }>(`SELECT role FROM admins WHERE id = ?`, id);
  if (!target) redirect("/admin/settings?error=Team+member+not+found");
  if (canAdminister(target.role as Parameters<typeof canAdminister>[0]) && role === "teacher_owner") {
    const superAdmins = get<{ count: number }>(`SELECT COUNT(*) AS count FROM admins WHERE role IN ('super_admin','owner','admin')`)!.count;
    if (superAdmins <= 1) redirect("/admin/settings?error=Create+another+Super+Admin+before+demoting+this+account");
  }
  run(`UPDATE admins SET role = ?, updated_at = ? WHERE id = ?`, role, nowIso(), id);
  audit("team.member_role_updated", { actorType: "admin", actor: admin.email, entityType: "admin", entityId: id, detail: { from: target.role, to: role } });
  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  redirect("/admin/settings?team=role-updated");
}

void setSetting;
