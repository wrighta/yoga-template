"use client";

import { useId, useRef, useState } from "react";
import { uploadMediaInlineAction } from "@/app/admin/actions-media";
import { downscaleImage, MAX_ORIGINAL_BYTES, MAX_UPLOAD_BYTES, mb } from "@/lib/media-image";

export type PickerMedia = { id: number; alt: string; mime: string };

/**
 * Owner-friendly image chooser: shows the current image, opens a panel to pick
 * from the library or clear the selection. The selected id lands in a hidden
 * input named `name` so a normal form save picks it up.
 */
export function MediaPicker({
  name,
  label,
  media,
  currentId,
  help,
}: {
  name: string;
  label: string;
  media: PickerMedia[];
  currentId: number | null;
  help?: string;
}) {
  const pickerId = useId().replaceAll(":", "");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(currentId);
  const [images, setImages] = useState(media);
  const [uploadAlt, setUploadAlt] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const current = images.find((m) => m.id === selected) ?? null;

  async function uploadInline(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_ORIGINAL_BYTES) {
      setUploadMessage(`This photo is ${mb(file.size)}. Choose one under ${mb(MAX_ORIGINAL_BYTES)}.`);
      return;
    }
    setUploading(true);
    setUploadMessage("");
    try {
      const resized = await downscaleImage(file);
      if (resized.size > MAX_UPLOAD_BYTES) {
        setUploadMessage(`After resizing, this photo is ${mb(resized.size)}. Choose a smaller photo.`);
        return;
      }
      const data = new FormData();
      data.set("file", resized);
      data.set("alt", uploadAlt);
      const result = await uploadMediaInlineAction(data);
      if (!result.ok || !result.media) {
        setUploadMessage(result.message);
        return;
      }
      setImages((items) => [result.media!, ...items]);
      setSelected(result.media.id);
      setUploadAlt("");
      setUploadMessage(result.message);
      setOpen(false);
    } catch {
      setUploadMessage("Photo upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-forest-900">{label}</span>
      <input type="hidden" name={name} value={selected ?? ""} />
      <div className="flex items-start gap-4">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-oat-300 bg-oat-100">
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${current.id}`} alt={current.alt || "Selected image"} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-bark-500">None set</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-h-[40px] rounded-full border-2 border-forest-800 px-4 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100">
              {current ? "Change image" : "Choose image"}
            </button>
            {current ? (
              <button type="button" onClick={() => { setSelected(null); setOpen(false); }} className="min-h-[40px] rounded-full px-3 py-2 text-sm font-semibold text-clay-700 underline underline-offset-4">
                Remove
              </button>
            ) : null}
          </div>
          {help ? <p className="text-xs text-bark-500">{help}</p> : null}
          {uploadMessage ? <p role="status" className="text-sm text-bark-700">{uploadMessage}</p> : null}
          {open && (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-oat-200 bg-oat-50 p-3">
              {images.length === 0 ? (
                <p className="text-sm text-bark-500">
                  No images in the library yet. Upload one below and it will be selected here.
                </p>
              ) : (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  <li>
                    <button
                      type="button"
                      onClick={() => { setSelected(null); setOpen(false); }}
                      className="flex h-16 w-full items-center justify-center rounded-lg border border-dashed border-oat-300 text-xs text-bark-500 hover:bg-white"
                    >
                      None
                    </button>
                  </li>
                  {images.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => { setSelected(m.id); setOpen(false); }}
                        className={`h-16 w-full overflow-hidden rounded-lg border-2 ${selected === m.id ? "border-forest-700" : "border-transparent"} hover:border-forest-700/50`}
                        title={m.alt || `Image ${m.id}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/media/${m.id}`} alt={m.alt || `Image ${m.id}`} className="h-full w-full object-cover" loading="lazy" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 border-t border-oat-200 pt-4">
                <input ref={uploadRef} id={`inline-upload-${pickerId}`} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => void uploadInline(event.target.files?.[0])} />
                <label htmlFor={`inline-upload-${pickerId}`} className={`inline-flex min-h-10 cursor-pointer items-center rounded-full border-2 border-forest-800 px-4 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100 ${uploading ? "pointer-events-none opacity-50" : ""}`}>
                  {uploading ? "Uploading…" : "Browse and upload photo"}
                </label>
                <label htmlFor={`inline-alt-${pickerId}`} className="mt-3 flex flex-col gap-1.5 text-xs font-semibold text-forest-900">Alt text (optional)<input id={`inline-alt-${pickerId}`} value={uploadAlt} onChange={(event) => setUploadAlt(event.target.value)} className="rounded-lg border border-oat-300 px-3 py-2 text-sm font-normal" placeholder="Describe what the photo shows" /></label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
