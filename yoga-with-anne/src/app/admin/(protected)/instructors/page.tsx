import { all } from "@/db";
import { Card, Alert, Field } from "@/components/ui";
import { saveInstructorAction } from "@/app/admin/actions-setup";
import { requireSuperAdminPage } from "@/lib/auth";

export default async function AdminInstructorsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSuperAdminPage();
  const sp = await searchParams;
  const instructors = all<{ id: number; name: string; bio: string | null; active: number }>(
    `SELECT * FROM instructors ORDER BY active DESC, id ASC`
  );

  const instructorForm = (i?: (typeof instructors)[number]) => (
    <form action={saveInstructorAction} className="grid gap-4">
      {i ? <input type="hidden" name="id" value={i.id} /> : null}
      <Field label="Name" name="name" defaultValue={i?.name ?? ""} required />
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
        Short bio (shown in the admin area; the public About page has its own section under Content)
        <textarea name="bio" rows={3} defaultValue={i?.bio ?? ""} className="rounded-xl border border-oat-300 px-4 py-3" />
      </label>
      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={i ? !!i.active : true} className="h-5 w-5 rounded accent-forest-800" /> Active (selectable when creating classes)
        </label>
        <button type="submit" className="min-h-[44px] rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white hover:bg-forest-900">
          {i ? "Save instructor" : "Add instructor"}
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Instructors</h1>
      {sp.saved ? <Alert kind="success">Instructor saved.</Alert> : null}
      {sp.error ? <Alert kind="error">{sp.error}</Alert> : null}

      <div className="space-y-6">
        {instructors.map((i) => (
          <Card key={i.id} className="p-6">
            <h2 className="text-lg font-semibold text-forest-900">
              {i.name} {!i.active ? <span className="ml-2 rounded-full bg-oat-100 px-2 py-0.5 text-xs text-bark-500">inactive</span> : null}
            </h2>
            <div className="mt-4">{instructorForm(i)}</div>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Add an instructor</h2>
        <div className="mt-4">{instructorForm()}</div>
      </Card>
    </div>
  );
}
