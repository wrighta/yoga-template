import { all, get } from "@/db";
import { Card, Alert, Field } from "@/components/ui";
import { getContent } from "@/lib/content";
import { saveContentAction, saveFaqAction, deleteFaqAction, saveTestimonialAction, savePolicyAction, saveHomepageLayoutAction, saveHomepageHeroButtonsAction } from "@/app/admin/actions";
import { listAllServices } from "@/lib/services";
import { listMedia } from "@/lib/media";
import { MediaPicker } from "@/components/media-picker";
import { saveServiceAction, deleteServiceAction } from "@/app/admin/actions-services";
import { requireSuperAdminPage } from "@/lib/auth";
import { getHomepageSections, HOMEPAGE_SECTION_DEFINITIONS } from "@/lib/homepage";

type Pairs = { intro: string; items: string[][] };

export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSuperAdminPage();
  const sp = await searchParams;
  const [home, about, prices, contact, faqs, testimonials, policies, services, media, homepageSections, customPages] = await Promise.all([
    getContent("home"),
    getContent("about"),
    getContent("prices"),
    getContent("contact"),
    all<{ id: number; question: string; answer: string; published: number }>(`SELECT * FROM faqs ORDER BY sort, id`),
    all<{ id: number; quote: string; attribution: string | null; consent_note: string | null; published: number }>(`SELECT * FROM testimonials ORDER BY sort, id`),
    all<{ slug: string; title: string; body_md: string; status: string; version: number; requires_acceptance: number; updated_at: string }>(`SELECT * FROM policies ORDER BY slug`),
    listAllServices(),
    listMedia(),
    getHomepageSections(),
    all<{ slug: string; title: string }>(`SELECT slug, title FROM site_pages WHERE status = 'published' ORDER BY title`),
  ]);
  const whatToExpect = (home.what_to_expect as unknown as Pairs | undefined) ?? { intro: "", items: [] };
  const whoSuits = (home.who_suits as unknown as Pairs | undefined) ?? { intro: "", items: [] };
  const approach = (about.approach as string[] | undefined) ?? [];
  const primaryHeroButton = home.hero_primary_button as unknown as { label?: string; href?: string; active?: string } | undefined;
  const secondaryHeroButton = home.hero_secondary_button as unknown as { label?: string; href?: string; active?: string } | undefined;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Content</h1>
      {sp.saved ? <Alert kind="success">Saved ({sp.saved}).</Alert> : null}
      {sp.error ? <Alert kind="error">{sp.error}</Alert> : null}
      <Alert kind="info">
        Everything here updates the live website immediately after saving. Nothing needs a developer.
      </Alert>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Homepage layout</h2>
        <p className="mt-1 text-sm text-bark-500">Choose which prepared sections appear and set their display order. Sections with no content may remain empty even when enabled.</p>
        <form action={saveHomepageLayoutAction} className="mt-4 space-y-2">
          {HOMEPAGE_SECTION_DEFINITIONS.map((definition) => {
            const section = homepageSections.find((item) => item.id === definition.id)!;
            return (
              <div key={definition.id} className="grid items-center gap-3 border-t border-oat-100 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
                <span className="font-semibold text-forest-900">{definition.label}</span>
                <label htmlFor={`home-${definition.id}-sort`} className="flex items-center gap-2 text-sm">Order<input id={`home-${definition.id}-sort`} name={`${definition.id}_sort`} type="number" min="1" max={HOMEPAGE_SECTION_DEFINITIONS.length} required defaultValue={section.sort} className="w-20 rounded-lg border border-oat-300 px-2 py-2" /></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`${definition.id}_active`} defaultChecked={section.active} className="h-5 w-5 accent-forest-800" />Shown</label>
              </div>
            );
          })}
          <button type="submit" className="mt-3 min-h-[44px] rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Save homepage layout</button>
        </form>
      </Card>

      {/* Homepage services */}
      <Card className="p-6" id="services">
        <h2 className="text-lg font-semibold text-forest-900">Homepage services</h2>
        <p className="mt-1 text-sm text-bark-500">
          These appear as clickable modules on the homepage. Each has its own image, description, and destination.
        </p>
        <form action={saveContentAction} className="mt-4 grid gap-3 border-t border-oat-100 pt-4 sm:grid-cols-2">
          <input type="hidden" name="page" value="home" />
          <input type="hidden" name="key" value="services_heading" />
          <Field label="Section heading" name="value" defaultValue={String(home.services_heading ?? "Explore classes and experiences")} required />
          <button type="submit" className="min-h-[44px] self-end rounded-full bg-forest-800 px-5 py-2.5 text-sm font-semibold text-white">Save heading</button>
        </form>
        <form action={saveContentAction} className="mt-3 grid gap-3 border-b border-oat-100 pb-4 sm:grid-cols-2">
          <input type="hidden" name="page" value="home" />
          <input type="hidden" name="key" value="services_sub" />
          <Field label="Section supporting text (optional)" name="value" defaultValue={String(home.services_sub ?? "Find the class or experience that feels right for you.")} />
          <button type="submit" className="min-h-[44px] self-end rounded-full border border-forest-800 px-5 py-2.5 text-sm font-semibold text-forest-800">Save supporting text</button>
        </form>
        <div className="mt-4 space-y-4">
          {services.map((svc) => (
            <form key={svc.id} action={saveServiceAction} className="grid gap-3 rounded-xl border border-oat-300 p-4 sm:grid-cols-2">
              <input type="hidden" name="id" value={svc.id} />
              <Field label="Module name" name="name" defaultValue={svc.name} required />
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
                Links to
                <select name="link" defaultValue={svc.link} className="rounded-xl border border-oat-300 px-4 py-3">
                  <option value="/classes">Classes &amp; schedule</option>
                  <option value="/workshops">Workshops</option>
                  <option value="/enquire">Private lessons &amp; retreats enquiry</option>
                  <option value="/prices">Prices</option>
                  <option value="/contact">Contact</option>
                  {customPages.map((page) => <option key={page.slug} value={`/${page.slug}`}>{page.title}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
                Short description
                <textarea name="description" rows={2} defaultValue={svc.description ?? ""} className="rounded-xl border border-oat-300 px-4 py-3" />
              </label>
              <div className="sm:col-span-2">
                <MediaPicker label="Module image" name="imageMediaId" media={media.map((m) => ({ id: m.id, alt: m.alt, mime: m.mime }))} currentId={svc.image_media_id} />
              </div>
              <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={!!svc.active} className="h-5 w-5 rounded accent-forest-800" /> Shown on homepage
                </label>
                <Field label="Sort order" name="sort" type="number" defaultValue={String(svc.sort)} className="!w-24" />
                <button type="submit" className="min-h-[44px] rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Save</button>
              </div>
            </form>
          ))}
        </div>
        <details className="mt-4 rounded-xl border border-dashed border-oat-300 p-4">
          <summary className="cursor-pointer font-semibold text-forest-900">+ Add a service module</summary>
          <form action={saveServiceAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Module name" name="name" required placeholder="e.g. Workshops" />
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
              Links to
              <select name="link" className="rounded-xl border border-oat-300 px-4 py-3">
                <option value="/classes">Classes &amp; schedule</option>
                <option value="/workshops">Workshops</option>
                <option value="/enquire">Private lessons &amp; retreats enquiry</option>
                <option value="/prices">Prices</option>
                <option value="/contact">Contact</option>
                {customPages.map((page) => <option key={page.slug} value={`/${page.slug}`}>{page.title}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900 sm:col-span-2">
              Short description
              <textarea name="description" rows={2} className="rounded-xl border border-oat-300 px-4 py-3" />
            </label>
            <div className="sm:col-span-2">
              <MediaPicker label="Module image (optional)" name="imageMediaId" media={media.map((m) => ({ id: m.id, alt: m.alt, mime: m.mime }))} currentId={null} />
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked className="h-5 w-5 rounded accent-forest-800" /> Shown on homepage
            </label>
            <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white sm:col-span-2">Add module</button>
          </form>
        </details>
        {services.map((svc) => (
          <form key={`del-${svc.id}`} action={deleteServiceAction} className="mt-2">
            <input type="hidden" name="id" value={svc.id} />
            <button type="submit" className="text-xs font-semibold text-clay-700 underline underline-offset-4">Delete “{svc.name}”</button>
          </form>
        ))}
      </Card>

      {/* Homepage */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Homepage hero</h2>
        <form action={saveContentAction} className="mt-4 grid gap-4">
          <input type="hidden" name="page" value="home" />
          <input type="hidden" name="key" value="hero_heading" />
          <Field label="Main headline" name="value" defaultValue={String(home.hero_heading ?? "")} required />
          <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Save headline</button>
        </form>
        <form action={saveContentAction} className="mt-4 grid gap-4 border-t border-oat-100 pt-4">
          <input type="hidden" name="page" value="home" />
          <input type="hidden" name="key" value="hero_sub" />
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
            Sub-headline
            <textarea name="value" rows={2} defaultValue={String(home.hero_sub ?? "")} className="rounded-xl border border-oat-300 px-4 py-3" />
          </label>
          <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Save sub-headline</button>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Hero buttons</h2>
        <p className="mt-1 text-sm text-bark-500">Edit either button, change its internal destination, or hide it.</p>
        <datalist id="hero-page-links">
          {[
            ["/classes", "Classes & schedule"], ["/workshops", "Workshops & retreats"], ["/about", "About"],
            ["/contact", "Contact"], ["/enquire", "Enquire"], ["/prices", "Prices"], ["/#new-here", "Homepage section: New to yoga"],
          ].map(([href, label]) => <option key={href} value={href}>{label}</option>)}
          {customPages.map((page) => <option key={page.slug} value={`/${page.slug}`}>{page.title}</option>)}
        </datalist>
        <form action={saveHomepageHeroButtonsAction} className="mt-4 grid gap-4 md:grid-cols-2">
          {[
            { key: "primary", title: "Primary button", button: primaryHeroButton, fallback: { label: "View classes & book", href: "/classes", active: "true" } },
            { key: "secondary", title: "Secondary button", button: secondaryHeroButton, fallback: { label: "New to yoga? Start here", href: "/#new-here", active: "true" } },
          ].map(({ key, title, button, fallback }) => (
            <fieldset key={key} className="grid content-start gap-3 rounded-lg border border-oat-200 p-4">
              <legend className="px-1 text-sm font-semibold text-forest-900">{title}</legend>
              <Field label="Button text" name={`${key}Label`} defaultValue={button?.label ?? fallback.label} required />
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">Internal destination<input name={`${key}Href`} list="hero-page-links" defaultValue={button?.href ?? fallback.href} required className="rounded-xl border border-oat-300 px-4 py-3 font-normal" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`${key}Active`} defaultChecked={(button?.active ?? fallback.active) !== "false"} className="h-5 w-5 accent-forest-800" />Show button</label>
            </fieldset>
          ))}
          <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white md:col-span-2">Save hero buttons</button>
        </form>
      </Card>

      {[
        { title: "“What to expect” section", page: "home", key: "what_to_expect", data: whatToExpect },
        { title: "“Who the classes suit” section", page: "home", key: "who_suits", data: whoSuits },
      ].map((section) => (
        <Card key={section.key} className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">{section.title}</h2>
          <form action={saveContentAction} className="mt-4 grid gap-4">
            <input type="hidden" name="page" value={section.page} />
            <input type="hidden" name="key" value={section.key} />
            <input type="hidden" name="type" value="pairs" />
            <Field label="Section intro" name="intro" defaultValue={section.data.intro} />
            {Array.from({ length: Math.max(4, section.data.items.length) }).map((_, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <Field label={`Item ${i + 1} title`} name="itemTitle" defaultValue={section.data.items[i]?.[0] ?? ""} />
                <Field label={`Item ${i + 1} text`} name="itemBody" defaultValue={section.data.items[i]?.[1] ?? ""} />
              </div>
            ))}
            <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Save section</button>
          </form>
        </Card>
      ))}

      {/* About */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">About Anne page</h2>
        <form action={saveContentAction} className="mt-4 grid gap-4">
          <input type="hidden" name="page" value="about" />
          <input type="hidden" name="key" value="bio" />
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
            Biography
            <textarea name="value" rows={5} defaultValue={String(about.bio ?? "")} className="rounded-xl border border-oat-300 px-4 py-3" />
          </label>
          <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Save biography</button>
        </form>
        <form action={saveContentAction} className="mt-4 grid gap-4 border-t border-oat-100 pt-4">
          <input type="hidden" name="page" value="about" />
          <input type="hidden" name="key" value="approach" />
          <input type="hidden" name="type" value="list" />
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
            “How I teach” bullet points (one per line)
            <textarea name="value" rows={5} defaultValue={approach.join("\n")} className="rounded-xl border border-oat-300 px-4 py-3" />
          </label>
          <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Save bullets</button>
        </form>
        <form action={saveContentAction} className="mt-4 grid gap-4 border-t border-oat-100 pt-4">
          <input type="hidden" name="page" value="about" />
          <input type="hidden" name="key" value="qualifications_note" />
          <Field label="Qualifications (only add real, verifiable ones - left blank means the section is hidden)" name="value" defaultValue={String(about.qualifications_note ?? "")} />
          <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Save qualifications</button>
        </form>
      </Card>

      {/* Page intros */}
      {[
        { label: "Prices page intro", page: "prices", key: "intro", value: String(prices.intro ?? "") },
        { label: "Contact page intro", page: "contact", key: "intro", value: String(contact.intro ?? "") },
      ].map((f) => (
        <Card key={f.key + f.page} className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">{f.label}</h2>
          <form action={saveContentAction} className="mt-4 grid gap-4">
            <input type="hidden" name="page" value={f.page} />
            <input type="hidden" name="key" value={f.key} />
            <textarea name="value" rows={2} defaultValue={f.value} className="rounded-xl border border-oat-300 px-4 py-3" />
            <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Save</button>
          </form>
        </Card>
      ))}

      {/* FAQs */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">FAQs</h2>
        <div className="mt-4 space-y-4">
          {faqs.map((f) => (
            <form key={f.id} action={saveFaqAction} className="grid gap-3 rounded-xl border border-oat-200 p-4">
              <input type="hidden" name="id" value={f.id} />
              <input name="question" defaultValue={f.question} className="rounded-xl border border-oat-300 px-4 py-2.5 font-semibold" />
              <textarea name="answer" rows={3} defaultValue={f.answer} className="rounded-xl border border-oat-300 px-4 py-2.5" />
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="published" defaultChecked={!!f.published} className="h-5 w-5 rounded accent-forest-800" /> Published
                </label>
                <button type="submit" className="rounded-full bg-forest-800 px-5 py-2 text-sm font-semibold text-white">Save</button>
                <span className="flex-1" />
                <button type="submit" formAction={deleteFaqAction} className="text-sm font-semibold text-clay-700 underline underline-offset-4">Delete</button>
              </div>
            </form>
          ))}
        </div>
        <details className="mt-4 rounded-xl border border-dashed border-oat-300 p-4">
          <summary className="cursor-pointer font-semibold text-forest-900">+ Add a new question</summary>
          <form action={saveFaqAction} className="mt-4 grid gap-3">
            <input name="question" required placeholder="Question" className="rounded-xl border border-oat-300 px-4 py-2.5 font-semibold" />
            <textarea name="answer" required rows={3} placeholder="Answer" className="rounded-xl border border-oat-300 px-4 py-2.5" />
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="published" defaultChecked className="h-5 w-5 rounded accent-forest-800" /> Published
            </label>
            <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Add question</button>
          </form>
        </details>
      </Card>

      {/* Testimonials */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Testimonials</h2>
        <p className="mt-1 text-sm text-bark-500">Only add real quotes from real students, with their permission. The section stays hidden on the homepage until something is published.</p>
        <div className="mt-4 space-y-4">
          {testimonials.map((t) => (
            <form key={t.id} action={saveTestimonialAction} className="grid gap-3 rounded-xl border border-oat-200 p-4">
              <input type="hidden" name="id" value={t.id} />
              <textarea name="quote" rows={3} defaultValue={t.quote} className="rounded-xl border border-oat-300 px-4 py-2.5" required />
              <div className="grid gap-3 sm:grid-cols-2">
                <input name="attribution" defaultValue={t.attribution ?? ""} placeholder="e.g. Mary, Lucan" className="rounded-xl border border-oat-300 px-4 py-2.5" />
                <input name="consentNote" defaultValue={t.consent_note ?? ""} placeholder="Consent note, e.g. 'shared with permission'" className="rounded-xl border border-oat-300 px-4 py-2.5" />
              </div>
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="published" defaultChecked={!!t.published} className="h-5 w-5 rounded accent-forest-800" /> Published
                </label>
                <button type="submit" className="rounded-full bg-forest-800 px-5 py-2 text-sm font-semibold text-white">Save</button>
              </div>
            </form>
          ))}
        </div>
        <details className="mt-4 rounded-xl border border-dashed border-oat-300 p-4">
          <summary className="cursor-pointer font-semibold text-forest-900">+ Add a testimonial</summary>
          <form action={saveTestimonialAction} className="mt-4 grid gap-3">
            <textarea name="quote" required rows={3} placeholder="The quote" className="rounded-xl border border-oat-300 px-4 py-2.5" />
            <div className="grid gap-3 sm:grid-cols-2">
              <input name="attribution" placeholder="Who said it" className="rounded-xl border border-oat-300 px-4 py-2.5" />
              <input name="consentNote" placeholder="Consent note" className="rounded-xl border border-oat-300 px-4 py-2.5" />
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="published" className="h-5 w-5 rounded accent-forest-800" /> Published
            </label>
            <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white">Add</button>
          </form>
        </details>
      </Card>

      {/* Policies */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Legal &amp; policy pages</h2>
        <p className="mt-1 text-sm text-bark-500">
          Drafts are marked and hidden from the public site until you press <strong>Publish</strong>. Have the final wording
          checked by a legal professional before launch - these templates are a starting point, not legal advice.
        </p>
        <div className="mt-4 space-y-4">
          {policies.map((p) => (
            <form key={p.slug} action={savePolicyAction} className="grid gap-3 rounded-xl border border-oat-200 p-4">
              <input type="hidden" name="slug" value={p.slug} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-forest-900">
                  {p.title} <span className="ml-2 text-xs font-normal text-bark-500">v{p.version} · {p.status}{p.requires_acceptance ? " · accepted at checkout" : ""}</span>
                </h3>
                {p.status === "draft" ? <span className="rounded-full bg-gold-200 px-2.5 py-0.5 text-xs font-bold text-gold-700">DRAFT - needs review</span> : <span className="rounded-full bg-sage-100 px-2.5 py-0.5 text-xs font-bold text-forest-800">PUBLISHED</span>}
              </div>
              <textarea name="body" rows={10} defaultValue={p.body_md} className="rounded-xl border border-oat-300 px-4 py-2.5 font-mono text-xs" />
              <div className="flex gap-3">
                <button type="submit" className="rounded-full border-2 border-forest-800 px-5 py-2 text-sm font-semibold text-forest-800">Save draft</button>
                <button type="submit" name="publish" value="1" className="rounded-full bg-forest-800 px-5 py-2 text-sm font-semibold text-white">Publish live</button>
              </div>
            </form>
          ))}
        </div>
      </Card>
    </div>
  );
}
