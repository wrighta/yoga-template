import { all } from "@/db";
import { Card, Alert, Field } from "@/components/ui";
import { saveVenueAction } from "@/app/admin/actions-setup";
import { requireSuperAdminPage } from "@/lib/auth";

export default async function AdminVenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSuperAdminPage();
  const sp = await searchParams;
  const venues = all<{ id: number; name: string; address: string | null; postcode: string | null; map_url: string | null; directions: string | null; parking_notes: string | null; access_notes: string | null; active: number }>(
    `SELECT * FROM venues ORDER BY active DESC, id ASC`
  );

  const venueForm = (v?: (typeof venues)[number]) => (
    <form action={saveVenueAction} className="grid gap-4">
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Venue name" name="name" defaultValue={v?.name ?? ""} required />
        <Field label="Address" name="address" defaultValue={v?.address ?? ""} />
        <Field label="Eircode / postcode" name="postcode" defaultValue={v?.postcode ?? ""} />
        <Field label="Google Maps link" name="map_url" defaultValue={v?.map_url ?? ""} placeholder="https://maps.google.com/?q=…" />
        <Field label="Directions (shown on class pages)" name="directions" defaultValue={v?.directions ?? ""} className="sm:col-span-2" />
        <Field label="Parking information" name="parking_notes" defaultValue={v?.parking_notes ?? ""} />
        <Field label="Accessibility information" name="access_notes" defaultValue={v?.access_notes ?? ""} />
      </div>
      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={v ? !!v.active : true} className="h-5 w-5 rounded accent-forest-800" /> Active (selectable when creating classes)
        </label>
        <button type="submit" className="min-h-[44px] rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white hover:bg-forest-900">
          {v ? "Save venue" : "Add venue"}
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Venues</h1>
      {sp.saved ? <Alert kind="success">Venue saved.</Alert> : null}
      {sp.error ? <Alert kind="error">{sp.error}</Alert> : null}
      <Alert kind="info">The venue name, address, parking and accessibility details appear on every class page and on the homepage.</Alert>

      <div className="space-y-6">
        {venues.map((v) => (
          <Card key={v.id} className="p-6">
            <h2 className="text-lg font-semibold text-forest-900">
              {v.name} {!v.active ? <span className="ml-2 rounded-full bg-oat-100 px-2 py-0.5 text-xs text-bark-500">inactive</span> : null}
            </h2>
            <div className="mt-4">{venueForm(v)}</div>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Add a new venue</h2>
        <div className="mt-4">{venueForm()}</div>
      </Card>
    </div>
  );
}
