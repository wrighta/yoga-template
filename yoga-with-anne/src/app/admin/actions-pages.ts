"use server";

import { audit, get, run } from "@/db";
import { requireAdmin, canAdminister } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const RESERVED_SLUGS = new Set([
  "about", "account", "admin", "api", "book", "classes", "contact", "enquire", "faqs",
  "policies", "prices", "workshops",
]);

function internalPath(value: FormDataEntryValue | null): string | null {
  const path = String(value ?? "").trim();
  return path.startsWith("/") && !path.startsWith("//") && !/[\s<>"']/.test(path) ? path : null;
}

async function requireSuperAdmin() {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAdminister(admin.role)) redirect("/admin?error=Only+a+Super+Admin+can+manage+pages+and+menus");
  return admin;
}

function sectionsFromForm(formData: FormData): string | null {
  const headings = formData.getAll("sectionHeading");
  const bodies = formData.getAll("sectionBody");
  const imageIds = formData.getAll("sectionImageId");
  const buttonLabels = formData.getAll("sectionButtonLabel");
  const buttonHrefs = formData.getAll("sectionButtonHref");
  const orders = formData.getAll("sectionOrder");
  if (headings.length > 12) return null;
  let invalid = false;
  const sections = headings.map((heading, index) => {
    const body = String(bodies[index] ?? "").trim();
    const imageRaw = String(imageIds[index] ?? "").trim();
    const buttonLabel = String(buttonLabels[index] ?? "").trim();
    const buttonHrefRaw = String(buttonHrefs[index] ?? "").trim();
    const buttonHref = buttonHrefRaw ? internalPath(buttonHrefRaw) : null;
    const imageMediaId = imageRaw ? Number(imageRaw) : null;
    if ((buttonHrefRaw && !buttonHref) || (!!buttonLabel !== !!buttonHrefRaw) || (imageRaw && (!Number.isInteger(imageMediaId) || imageMediaId! < 1))) {
      invalid = true;
      return null;
    }
    const section = {
      heading: String(heading ?? "").trim(), body, imageMediaId, buttonLabel,
      buttonHref: buttonLabel && buttonHref ? buttonHref : "",
    };
    if (!Object.values(section).some((value) => value !== "" && value !== null)) return null;
    const order = Number(orders[index]);
    if (!Number.isInteger(order) || order < 1 || order > 12) {
      invalid = true;
      return null;
    }
    return { section, order, index };
  });
  if (invalid) return null;
  return JSON.stringify(sections.filter((entry) => entry !== null).sort((a, b) => a.order - b.order || a.index - b.index).map((entry) => entry.section));
}

async function saveSitePage(formData: FormData, forcedStatus?: "draft" | "published") {
  const admin = await requireSuperAdmin();
  const idRaw = String(formData.get("id") ?? "").trim();
  const id = idRaw ? Number(idRaw) : null;
  const title = String(formData.get("title") ?? "").trim().slice(0, 160);
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const intro = String(formData.get("intro") ?? "").trim().slice(0, 2000);
  const heroRaw = String(formData.get("heroMediaId") ?? "").trim();
  const heroMediaId = heroRaw ? Number(heroRaw) : null;
  const status = forcedStatus ?? String(formData.get("status") ?? "draft");
  const sectionsJson = sectionsFromForm(formData);
  if (!title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || RESERVED_SLUGS.has(slug)) {
    redirect("/admin/pages?error=Use+a+unique+slug+that+does+not+match+a+reserved+page");
  }
  if (status !== "draft" && status !== "published") redirect("/admin/pages?error=Invalid+publication+status");
  if ((heroRaw && (!Number.isInteger(heroMediaId) || heroMediaId! < 1)) || sectionsJson === null) {
    redirect("/admin/pages?error=Check+image+IDs+and+internal+section+links");
  }
  if (heroMediaId && !get(`SELECT id FROM media WHERE id = ?`, heroMediaId)) redirect("/admin/pages?error=Hero+image+not+found");
  if (sectionsJson) {
    const parsed = JSON.parse(sectionsJson) as { imageMediaId: number | null }[];
    if (parsed.some((section) => section.imageMediaId && !get(`SELECT id FROM media WHERE id = ?`, section.imageMediaId))) {
      redirect("/admin/pages?error=Section+image+not+found");
    }
  }
  if (id != null && (!Number.isInteger(id) || !get(`SELECT id FROM site_pages WHERE id = ?`, id))) redirect("/admin/pages?error=Page+not+found");
  try {
    if (id == null) {
      const result = run(`INSERT INTO site_pages (slug, title, intro, hero_media_id, sections_json, status) VALUES (?, ?, ?, ?, ?, ?)`, slug, title, intro || null, heroMediaId, sectionsJson, status);
      audit("site_page.created", { actorType: "admin", actor: admin.email, entityType: "site_page", entityId: Number(result.lastInsertRowid), detail: { slug, status } });
    } else {
      run(`UPDATE site_pages SET slug = ?, title = ?, intro = ?, hero_media_id = ?, sections_json = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, slug, title, intro || null, heroMediaId, sectionsJson, status, id);
      run(`UPDATE navigation_items SET href = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE page_id = ?`, `/${slug}`, id);
      audit("site_page.updated", { actorType: "admin", actor: admin.email, entityType: "site_page", entityId: id, detail: { slug, status } });
    }
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed: site_pages.slug")) redirect("/admin/pages?error=That+slug+is+already+in+use");
    throw error;
  }
  revalidatePath("/");
  revalidatePath(`/${slug}`);
  revalidatePath("/admin/pages");
  redirect("/admin/pages?saved=1");
}

export async function saveSitePageAction(formData: FormData) {
  await saveSitePage(formData);
}

export async function saveSitePageDraftAction(formData: FormData) {
  await saveSitePage(formData, "draft");
}

export async function publishSitePageAction(formData: FormData) {
  await saveSitePage(formData, "published");
}

export async function deleteSitePageAction(formData: FormData) {
  const admin = await requireSuperAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id < 1) redirect("/admin/pages?error=Invalid+page");
  const page = get<{ slug: string }>(`SELECT slug FROM site_pages WHERE id = ?`, id);
  if (!page) redirect("/admin/pages?error=Page+not+found");
  run(`DELETE FROM navigation_items WHERE page_id = ?`, id);
  run(`DELETE FROM site_pages WHERE id = ?`, id);
  audit("site_page.deleted", { actorType: "admin", actor: admin.email, entityType: "site_page", entityId: id, detail: { slug: page.slug } });
  revalidatePath("/");
  revalidatePath(`/${page.slug}`);
  revalidatePath("/admin/pages");
  redirect("/admin/pages?saved=1");
}

export async function saveNavigationItemAction(formData: FormData) {
  const admin = await requireSuperAdmin();
  const idRaw = String(formData.get("id") ?? "").trim();
  const id = idRaw ? Number(idRaw) : null;
  const label = String(formData.get("label") ?? "").trim().slice(0, 80);
  const href = internalPath(formData.get("href"));
  const placement = String(formData.get("placement") ?? "");
  const sort = Number(formData.get("sort"));
  const pageIdRaw = String(formData.get("pageId") ?? "").trim();
  const pageId = pageIdRaw ? Number(pageIdRaw) : null;
  if (!label || !href || !["primary", "footer"].includes(placement) || !Number.isInteger(sort)) {
    redirect("/admin/pages?error=Check+menu+label,+internal+URL,+placement+and+order");
  }
  if (pageIdRaw && (!Number.isInteger(pageId) || !get(`SELECT id FROM site_pages WHERE id = ?`, pageId))) redirect("/admin/pages?error=Linked+page+not+found");
  if (pageId) {
    const page = get<{ slug: string }>(`SELECT slug FROM site_pages WHERE id = ?`, pageId);
    if (href !== `/${page?.slug}`) redirect("/admin/pages?error=Linked+page+URL+must+match+its+slug");
  }
  const active = formData.get("active") === "on" ? 1 : 0;
  if (id == null) {
    const result = run(`INSERT INTO navigation_items (placement, label, href, sort, active, page_id) VALUES (?, ?, ?, ?, ?, ?)`, placement, label, href, sort, active, pageId);
    audit("navigation_item.created", { actorType: "admin", actor: admin.email, entityType: "navigation_item", entityId: Number(result.lastInsertRowid) });
  } else {
    if (!Number.isInteger(id) || !get(`SELECT id FROM navigation_items WHERE id = ?`, id)) redirect("/admin/pages?error=Menu+item+not+found");
    run(`UPDATE navigation_items SET placement = ?, label = ?, href = ?, sort = ?, active = ?, page_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, placement, label, href, sort, active, pageId, id);
    audit("navigation_item.updated", { actorType: "admin", actor: admin.email, entityType: "navigation_item", entityId: id });
  }
  revalidatePath("/", "layout");
  revalidatePath("/admin/pages");
  redirect("/admin/pages?saved=1");
}

export async function deleteNavigationItemAction(formData: FormData) {
  const admin = await requireSuperAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id < 1) redirect("/admin/pages?error=Invalid+menu+item");
  run(`DELETE FROM navigation_items WHERE id = ?`, id);
  audit("navigation_item.deleted", { actorType: "admin", actor: admin.email, entityType: "navigation_item", entityId: id });
  revalidatePath("/", "layout");
  revalidatePath("/admin/pages");
  redirect("/admin/pages?saved=1");
}