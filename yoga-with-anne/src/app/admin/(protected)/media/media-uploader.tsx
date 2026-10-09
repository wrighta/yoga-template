"use client";

import { useActionState, useState } from "react";
import { uploadMediaAction } from "@/app/admin/actions-media";
import { Alert } from "@/components/ui";
import { MAX_ORIGINAL_BYTES, MAX_UPLOAD_BYTES, downscaleImage, mb } from "@/lib/media-image";

/**
 * Upload limits (kept in sync with src/lib/media.ts, which re-validates
 * server-side):
 *  - MAX_ORIGINAL_BYTES: refuse absurd originals before decoding them;
 *  - MAX_UPLOAD_BYTES: the per-image cap AFTER automatic browser resizing.
 * The Server Action transport limit (next.config.ts) sits above this cap.
 */
export function MediaUploader() {
  const [state, action, pending] = useActionState(uploadMediaAction, null);
  const [picked, setPicked] = useState<string[]>([]);
  const [previews, setPreviews] = useState<{ name: string; url: string }[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);

  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      {state && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <div className="flex flex-col gap-2">
        <label htmlFor="media-file" className="flex min-h-14 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-forest-700 bg-sage-100 px-4 py-4 text-center font-semibold text-forest-900 hover:bg-sage-200">Browse photos to upload</label>
        <input
          id="media-file"
          type="file"
          name="files"
          accept="image/jpeg,image/png,image/webp"
          multiple
          required
          className="sr-only"
          aria-describedby="media-limits"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            const tooBigBefore: string[] = [];
            const checked: File[] = [];
            // size pre-check BEFORE decoding: instant, friendly feedback
            for (const f of files) {
              if (f.size > MAX_ORIGINAL_BYTES) {
                tooBigBefore.push(`${f.name} (${mb(f.size)}) - photos must be under ${mb(MAX_ORIGINAL_BYTES)}`);
              } else {
                checked.push(f);
              }
            }
            const resized = await Promise.all(checked.map(downscaleImage));
            const acceptable: File[] = [];
            const tooBigAfter: string[] = [];
            for (const f of resized) {
              if (f.size > MAX_UPLOAD_BYTES) {
                tooBigAfter.push(`${f.name} (${mb(f.size)} after automatic resizing) - photos must be under ${mb(MAX_UPLOAD_BYTES)}`);
              } else {
                acceptable.push(f);
              }
            }
            const rejectedMessages = [...tooBigBefore, ...tooBigAfter];
            setRejected(rejectedMessages);
            const dt = new DataTransfer();
            acceptable.forEach((f) => dt.items.add(f));
            e.target.files = dt.files;
            setPicked(acceptable.map((f) => f.name));
            setPreviews(acceptable.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })));
          }}
        />
        <p id="media-limits" className="text-xs text-bark-500">
          JPEG, PNG or WebP · photos are resized automatically in your browser · maximum 4 MB per photo after resizing -
          you&apos;ll be told immediately if a photo is too big, before anything uploads.
        </p>
        {rejected.length > 0 && (
          <div role="alert" data-testid="media-too-big" className="rounded-xl bg-clay-100 px-4 py-3 text-sm font-medium text-clay-700">
            <p className="font-semibold">Too big to upload:</p>
            <ul className="mt-1 list-disc pl-5">
              {rejected.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">The photos listed above were not added. All other photos can be uploaded as normal.</p>
          </div>
        )}
        {previews.length > 0 && (
          <ul className="flex flex-wrap gap-3">
            {previews.map((p) => (
              <li key={p.name} className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Preview of ${p.name}`} className="h-20 w-20 rounded-xl border border-oat-200 object-cover" />
                <span className="mt-1 block max-w-20 truncate text-xs text-bark-500">{p.name}</span>
              </li>
            ))}
          </ul>
        )}
        {picked.length > 0 && (
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
            Alt text - what the photo shows (used by screen readers; applies to all photos in this upload)
            <input name="alt" placeholder="e.g. The hall set up for class" className="rounded-xl border border-oat-300 px-4 py-3 text-base font-normal" />
          </label>
        )}
      </div>
      <button type="submit" disabled={pending || picked.length === 0} className="min-h-[48px] w-fit rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900 disabled:opacity-50 disabled:cursor-not-allowed">
        {pending ? "Uploading…" : picked.length === 0 && rejected.length > 0 ? "No photos to upload" : "Upload"}
      </button>
    </form>
  );
}
