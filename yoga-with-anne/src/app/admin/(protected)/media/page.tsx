import { listMedia } from "@/lib/media";
import { Card, Alert } from "@/components/ui";
import { MediaUploader } from "./media-uploader";
import { updateMediaAltAction, deleteMediaAction } from "@/app/admin/actions-media";
import { getSettings } from "@/lib/settings";
import { requireSuperAdminPage } from "@/lib/auth";

export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSuperAdminPage();
  const { error } = await searchParams;
  const [media, settings] = await Promise.all([listMedia(), getSettings()]);
  const inUse = new Set(
    [settings.logo_media_id, settings.hero_media_id, settings.portrait_media_id, settings.og_media_id].filter(
      (n): n is number => typeof n === "number"
    )
  );

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Photos &amp; images</h1>
      <Alert kind="info">
        Upload photos here, then choose them in <strong>Settings</strong> (homepage hero, Anne&apos;s portrait, logo,
        social sharing image) or on a class type. Photos are resized automatically in your browser before uploading.
        Only JPEG, PNG or WebP, up to 4 MB per photo after resizing - if a photo is too big you&apos;ll be told immediately and nothing is uploaded. Alt text describes the image for screen readers - please fill it in.
      </Alert>
      {error ? <Alert kind="error">{error}</Alert> : null}

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Upload images</h2>
        <MediaUploader />
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Library ({media.length})</h2>
        {media.length === 0 ? (
          <p className="mt-4 text-bark-500">No images yet - upload the first one above.</p>
        ) : (
          <ul className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {media.map((m) => (
              <li key={m.id} className="overflow-hidden rounded-[var(--radius-card)] border border-oat-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${m.id}`}
                  alt={m.alt || "Uploaded image"}
                  className="h-44 w-full bg-oat-100 object-cover"
                  loading="lazy"
                />
                <div className="space-y-3 p-4">
                  <form action={updateMediaAltAction} className="flex flex-col gap-2">
                    <input type="hidden" name="id" value={m.id} />
                    <label className="text-xs font-semibold text-bark-500" htmlFor={`alt-${m.id}`}>
                      Alt text (what the image shows)
                    </label>
                    <input
                      id={`alt-${m.id}`}
                      name="alt"
                      defaultValue={m.alt}
                      className="rounded-lg border border-oat-300 px-3 py-2 text-sm"
                      placeholder="e.g. The hall set up for class"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <button type="submit" className="rounded-full bg-forest-800 px-4 py-2 text-xs font-semibold text-white">
                        Save alt text
                      </button>
                      <span className="text-xs text-bark-500">
                        {(m.size / 1024).toFixed(0)} KB · {m.mime.replace("image/", "")}
                        {inUse.has(m.id) ? " · in use" : ""}
                      </span>
                    </div>
                  </form>
                  <form action={deleteMediaAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit" className="text-xs font-semibold text-clay-700 underline underline-offset-4">
                      Delete image
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
