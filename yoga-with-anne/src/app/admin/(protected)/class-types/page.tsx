import { all } from "@/db";
import { listMedia } from "@/lib/media";
import { Card, Alert, Field } from "@/components/ui";
import { MediaPicker } from "@/components/media-picker";
import { saveClassTypeAction } from "@/app/admin/actions-setup";
import { requireSuperAdminPage } from "@/lib/auth";

export default async function AdminClassTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSuperAdminPage();
  const sp = await searchParams;
  const [types, media] = await Promise.all([
    all<{ id: number; name: string; slug: string; description: string | null; suitability: string | null; what_to_bring: string | null; accessibility_note: string | null; duration_minutes: number; image_media_id: number | null; active: number }>(
      `SELECT * FROM class_types ORDER BY active DESC, id ASC`
    ),
    listMedia(),
  ]);
  const pickerMedia = media.map((m) => ({ id: m.id, alt: m.alt, mime: m.mime }));

  const typeForm = (t?: (typeof types)[number]) => (
    <form action={saveClassTypeAction} className="grid gap-4">
      {t ? <input type="hidden" name="id" value={t.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class name" name="name" defaultValue={t?.name ?? ""} required placeholder="e.g. Gentle Yoga & Meditation" />
        <Field label="Typical length (minutes)" name="duration" type="number" defaultValue={String(t?.duration_minutes ?? 60)} />
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
          Description (shown on every class page)
          <textarea name="description" rows={3} defaultValue={t?.description ?? ""} className="rounded-xl border border-oat-300 px-4 py-3" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
          Who it suits
          <textarea name="suitability" rows={3} defaultValue={t?.suitability ?? ""} className="rounded-xl border border-oat-300 px-4 py-3" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
          What to bring
          <textarea name="what_to_bring" rows={2} defaultValue={t?.what_to_bring ?? ""} className="rounded-xl border border-oat-300 px-4 py-3" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
          Accessibility &amp; wellbeing note
          <textarea name="accessibility_note" rows={2} defaultValue={t?.accessibility_note ?? ""} className="rounded-xl border border-oat-300 px-4 py-3" />
        </label>
      </div>
      {t ? null : (
        <Field label="Web address name (used in links - letters, numbers and dashes)" name="slug" placeholder="gentle-yoga-meditation" hint="Only needed when creating; it can't change later without breaking old links." />
      )}
      <MediaPicker name="image_media_id" label="Class photo (optional)" media={pickerMedia} currentId={t?.image_media_id ?? null} help="Shown on the class detail page." />
      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={t ? !!t.active : true} className="h-5 w-5 rounded accent-forest-800" /> Active (selectable when creating classes)
        </label>
        <button type="submit" className="min-h-[44px] rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white hover:bg-forest-900">
          {t ? "Save class type" : "Add class type"}
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Class types</h1>
      {sp.saved ? <Alert kind="success">Class type saved.</Alert> : null}
      {sp.error ? <Alert kind="error">{sp.error}</Alert> : null}
      <Alert kind="info">A “class type” is the kind of class you teach - its description, suitability and what to bring. Individual dates are managed under <strong>Schedule</strong>.</Alert>

      <div className="space-y-6">
        {types.map((t) => (
          <Card key={t.id} className="p-6">
            <h2 className="text-lg font-semibold text-forest-900">
              {t.name} {!t.active ? <span className="ml-2 rounded-full bg-oat-100 px-2 py-0.5 text-xs text-bark-500">inactive</span> : null}
            </h2>
            <p className="text-xs text-bark-500">/classes/type: {t.slug}</p>
            <div className="mt-4">{typeForm(t)}</div>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Add a new class type</h2>
        <div className="mt-4">{typeForm()}</div>
      </Card>
    </div>
  );
}
