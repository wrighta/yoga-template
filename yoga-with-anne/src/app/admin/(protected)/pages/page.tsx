import { all } from "@/db";
import { Alert, Card } from "@/components/ui";
import { requireSuperAdminPage } from "@/lib/auth";
import { listMedia } from "@/lib/media";
import { deleteNavigationItemAction, deleteSitePageAction, publishSitePageAction, saveNavigationItemAction, saveSitePageAction, saveSitePageDraftAction } from "@/app/admin/actions-pages";

type PageRow = { id: number; slug: string; title: string; intro: string | null; hero_media_id: number | null; sections_json: string; status: "draft" | "published" };
type NavRow = { id: number; placement: "primary" | "footer"; label: string; href: string; sort: number; active: number; page_id: number | null };
type Section = { heading?: string; body?: string; imageMediaId?: number | null; buttonLabel?: string; buttonHref?: string };
type ImageOption = { id: number; filename: string | null; alt: string };

function parseSections(json: string): Section[] {
  try {
    const sections: unknown = JSON.parse(json);
    return Array.isArray(sections) ? sections as Section[] : [];
  } catch {
    return [];
  }
}

function Input({ id, label, name, value, required = false, type = "text", placeholder }: { id: string; label: string; name: string; value?: string; required?: boolean; type?: string; placeholder?: string }) {
  return <label htmlFor={id} className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-forest-900">{label}<input id={id} name={name} type={type} defaultValue={value} required={required} placeholder={placeholder} className="w-full min-w-0 rounded-xl border border-oat-300 bg-white px-4 py-3 text-base" /></label>;
}

function ImageSelect({ id, name, label, value, media }: { id: string; name: string; label: string; value: number | null; media: ImageOption[] }) {
  return <label htmlFor={id} className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-forest-900">{label}<select id={id} name={name} defaultValue={value ?? ""} className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3"><option value="">No image</option>{media.map((item) => <option key={item.id} value={item.id}>{item.filename || item.alt || `Image ${item.id}`} (#{item.id})</option>)}</select></label>;
}

function SectionFields({ section, prefix, media, order }: { section?: Section; prefix: string; media: ImageOption[]; order: number }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border border-oat-200 p-4 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold text-bark-600">{prefix.replaceAll("-", " ")}</legend>
      <Input id={`${prefix}-order`} label="Display order" name="sectionOrder" type="number" value={String(order)} />
      <Input id={`${prefix}-heading`} label="Heading" name="sectionHeading" value={section?.heading ?? ""} />
      <ImageSelect id={`${prefix}-image`} name="sectionImageId" label="Image" value={section?.imageMediaId ?? null} media={media} />
      <label htmlFor={`${prefix}-body`} className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">Text<textarea id={`${prefix}-body`} name="sectionBody" rows={3} defaultValue={section?.body ?? ""} className="w-full min-w-0 rounded-xl border border-oat-300 px-4 py-3" /></label>
      <Input id={`${prefix}-button-label`} label="Button label" name="sectionButtonLabel" value={section?.buttonLabel ?? ""} />
      <Input id={`${prefix}-button-href`} label="Button URL (internal)" name="sectionButtonHref" value={section?.buttonHref ?? ""} placeholder="/contact" />
    </fieldset>
  );
}

export default async function AdminPagesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requireSuperAdminPage();
  const params = await searchParams;
  const [pages, menus, mediaRows] = await Promise.all([
    all<PageRow>(`SELECT * FROM site_pages ORDER BY updated_at DESC, id DESC`),
    all<NavRow>(`SELECT * FROM navigation_items ORDER BY placement, sort, id`),
    listMedia(),
  ]);
  const pageOptions = pages.map((page) => ({ id: page.id, slug: page.slug, title: page.title }));
  const media = mediaRows.map(({ id, filename, alt }) => ({ id, filename, alt }));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-forest-900">Pages &amp; menus</h1>
        <p className="mt-2 max-w-3xl text-bark-600">Create reusable pages, then place links in the header or footer. Draft pages stay private and their menu links are hidden.</p>
      </header>
      {params.saved ? <Alert kind="success">Changes saved.</Alert> : null}
      {params.error ? <Alert kind="error">{params.error.replaceAll("+", " ")}</Alert> : null}

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-forest-900">Pages</h2>
        <div className="mt-5 space-y-5">
          {pages.map((page) => {
            const sections = parseSections(page.sections_json);
            return (
              <div key={page.id} className="border-t border-oat-200 pt-5">
                <form action={saveSitePageAction} className="space-y-4">
                  <input type="hidden" name="id" value={page.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input id={`page-${page.id}-title`} label="Page title" name="title" value={page.title} required />
                    <Input id={`page-${page.id}-slug`} label="URL slug" name="slug" value={page.slug} required />
                  </div>
                  <label htmlFor={`page-${page.id}-intro`} className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-forest-900">Introduction<textarea id={`page-${page.id}-intro`} name="intro" rows={2} defaultValue={page.intro ?? ""} className="w-full min-w-0 rounded-xl border border-oat-300 px-4 py-3" /></label>
                  <ImageSelect id={`page-${page.id}-hero`} name="heroMediaId" label="Hero image" value={page.hero_media_id} media={media} />
                  <div className="space-y-3">
                    <h3 className="font-semibold text-forest-900">Sections, in display order</h3>
                    {Array.from({ length: Math.min(12, Math.max(3, sections.length + 3)) }, (_, index) => {
                      const prefix = `page-${page.id}-section-${index + 1}`;
                      const fields = <SectionFields section={sections[index]} prefix={prefix} media={media} order={index + 1} />;
                      return index < sections.length ? <div key={index}>{fields}</div> : <details key={index} className="rounded-lg border border-dashed border-oat-300 p-3"><summary className="cursor-pointer text-sm font-semibold text-forest-900">Add section {index + 1}</summary><div className="mt-3">{fields}</div></details>;
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-bark-600">Current: {page.status}</span>
                    <button formAction={saveSitePageDraftAction} className="min-h-11 rounded-full border border-oat-300 px-5 text-sm font-semibold text-forest-900">Save draft</button>
                    <button formAction={publishSitePageAction} className="min-h-11 rounded-full bg-forest-800 px-5 text-sm font-semibold text-white">Publish</button>
                    {page.status === "published"
                      ? <a href={`/${page.slug}`} className="text-sm font-semibold text-forest-800 underline underline-offset-4">View page</a>
                      : <a href={`/${page.slug}?preview=1`} className="text-sm font-semibold text-forest-800 underline underline-offset-4">Preview draft</a>}
                  </div>
                </form>
                <form action={deleteSitePageAction} className="mt-3"><input type="hidden" name="id" value={page.id} /><button className="text-sm font-semibold text-clay-700 underline underline-offset-4">Delete page</button></form>
              </div>
            );
          })}
          {pages.length === 0 ? <p className="text-sm text-bark-600">No custom pages yet.</p> : null}
        </div>
        <details className="mt-6 border-t border-oat-200 pt-5">
          <summary className="cursor-pointer font-semibold text-forest-900">Create a page</summary>
          <form action={saveSitePageAction} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2"><Input id="new-page-title" label="Page title" name="title" required /><Input id="new-page-slug" label="URL slug" name="slug" required placeholder="my-new-page" /></div>
            <label htmlFor="new-page-intro" className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-forest-900">Introduction<textarea id="new-page-intro" name="intro" rows={2} className="w-full min-w-0 rounded-xl border border-oat-300 px-4 py-3" /></label>
            <ImageSelect id="new-page-hero" name="heroMediaId" label="Hero image" value={null} media={media} />
            {Array.from({ length: 12 }, (_, index) => {
              const prefix = `new-page-section-${index + 1}`;
              const fields = <SectionFields prefix={prefix} media={media} order={index + 1} />;
              return index < 3 ? <div key={index}>{fields}</div> : <details key={index} className="rounded-lg border border-dashed border-oat-300 p-3"><summary className="cursor-pointer text-sm font-semibold text-forest-900">Add section {index + 1}</summary><div className="mt-3">{fields}</div></details>;
            })}
            <div className="flex gap-3"><button formAction={saveSitePageDraftAction} className="min-h-11 rounded-full border border-oat-300 px-5 text-sm font-semibold text-forest-900">Save draft</button><button formAction={publishSitePageAction} className="min-h-11 rounded-full bg-forest-800 px-5 text-sm font-semibold text-white">Publish</button></div>
          </form>
        </details>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-forest-900">Navigation</h2>
        <p className="mt-1 text-sm text-bark-600">Primary items appear in the header and mobile menu; footer items appear in the Information column.</p>
        <div className="mt-5 space-y-4">
          {menus.map((item) => (
            <div key={item.id} className="border-t border-oat-200 pt-4">
              <form action={saveNavigationItemAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <input type="hidden" name="id" value={item.id} />
                <Input id={`menu-${item.id}-label`} label="Label" name="label" value={item.label} required />
                <Input id={`menu-${item.id}-href`} label="Internal URL" name="href" value={item.href} required />
                <label htmlFor={`menu-${item.id}-page`} className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-forest-900">Linked custom page<select id={`menu-${item.id}-page`} name="pageId" defaultValue={item.page_id ?? ""} className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3"><option value="">Manual URL</option>{pageOptions.map((page) => <option key={page.id} value={page.id}>{page.title} (/{page.slug})</option>)}</select></label>
                <label htmlFor={`menu-${item.id}-placement`} className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-forest-900">Placement<select id={`menu-${item.id}-placement`} name="placement" defaultValue={item.placement} className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3"><option value="primary">Header / mobile</option><option value="footer">Footer</option></select></label>
                <Input id={`menu-${item.id}-sort`} label="Order" name="sort" type="number" value={String(item.sort)} />
                <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" name="active" defaultChecked={!!item.active} className="h-5 w-5 accent-forest-800" />Visible</label>
                <button className="min-h-11 w-fit rounded-full bg-forest-800 px-5 text-sm font-semibold text-white">Save menu item</button>
              </form>
              <form action={deleteNavigationItemAction} className="mt-2"><input type="hidden" name="id" value={item.id} /><button className="text-xs font-semibold text-clay-700 underline underline-offset-4">Delete menu item</button></form>
            </div>
          ))}
        </div>
        <form action={saveNavigationItemAction} className="mt-6 grid gap-3 border-t border-oat-200 pt-5 sm:grid-cols-2 lg:grid-cols-3">
          <Input id="new-menu-label" label="Label" name="label" required placeholder="New page" />
          <Input id="new-menu-href" label="Internal URL" name="href" required placeholder="/new-page" />
          <label htmlFor="new-menu-page" className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-forest-900">Linked custom page<select id="new-menu-page" name="pageId" defaultValue="" className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3"><option value="">Manual URL</option>{pageOptions.map((page) => <option key={page.id} value={page.id}>{page.title} (/{page.slug})</option>)}</select></label>
          <label htmlFor="new-menu-placement" className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-forest-900">Placement<select id="new-menu-placement" name="placement" defaultValue="primary" className="w-full min-w-0 max-w-full rounded-xl border border-oat-300 px-4 py-3"><option value="primary">Header / mobile</option><option value="footer">Footer</option></select></label>
          <Input id="new-menu-sort" label="Order" name="sort" type="number" value="70" />
          <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" name="active" defaultChecked className="h-5 w-5 accent-forest-800" />Visible</label>
          <button className="min-h-11 w-fit rounded-full bg-forest-800 px-5 text-sm font-semibold text-white">Add menu item</button>
        </form>
      </Card>
    </div>
  );
}