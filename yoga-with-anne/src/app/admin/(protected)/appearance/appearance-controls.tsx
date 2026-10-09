"use client";

import { useState } from "react";
import { saveAppearanceAction } from "@/app/admin/actions-appearance";
import type { Palette } from "@/lib/appearance";

const SWATCH_ROLES: (keyof Palette["vars"])[] = ["--b800", "--t200", "--s50", "--a600", "--a200"];

export function AppearanceControls({ palettes, currentPalette, currentAccent }: { palettes: Palette[]; currentPalette: string; currentAccent: string | null }) {
  const [paletteId, setPaletteId] = useState(currentPalette);
  const [accent, setAccent] = useState(currentAccent ?? "#b85c3f");
  const [clearAccent, setClearAccent] = useState(currentAccent === null);

  function openPreview() {
    const params = new URLSearchParams({ appearance_preview: "1", palette_id: paletteId });
    params.set("accent_color", clearAccent ? "" : accent);
    window.open(`/?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  return (
    <form action={saveAppearanceAction}>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <h2 className="text-lg font-semibold text-forest-900">Colour palette</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {palettes.map((palette) => (
              <label key={palette.id} className="flex cursor-pointer items-start gap-4 rounded-[var(--radius-card)] border-2 p-4 has-[:checked]:border-forest-700 has-[:checked]:ring-2 has-[:checked]:ring-forest-700/30">
                <input type="radio" name="palette_id" value={palette.id} checked={paletteId === palette.id} onChange={() => setPaletteId(palette.id)} className="mt-1 h-5 w-5 accent-forest-800" />
                <span className="flex-1">
                  <span className="block font-semibold text-forest-900">{palette.name}</span>
                  <span className="mt-2 flex overflow-hidden rounded-lg border border-oat-200">
                    {SWATCH_ROLES.map((role) => <span key={role} className="h-8 flex-1" style={{ backgroundColor: palette.vars[role] }} aria-hidden="true" />)}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <h2 className="mt-8 border-t border-oat-100 pt-6 text-lg font-semibold text-forest-900">Custom accent colour (optional)</h2>
          <p className="mt-1 text-sm text-bark-500">Pick a brand colour for buttons, links and highlights. Leave it unused to keep the palette&apos;s accent.</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <input type="color" name="accent_color" value={accent} onChange={(event) => { setAccent(event.target.value); setClearAccent(false); }} className="h-14 w-24 cursor-pointer rounded-xl border border-oat-300 bg-white p-1" aria-label="Custom accent colour" />
            <label className="flex items-center gap-2 text-sm text-bark-700">
              <input type="checkbox" name="clear_accent" value="1" checked={clearAccent} onChange={(event) => setClearAccent(event.target.checked)} className="h-5 w-5 rounded accent-forest-800" />
              Use the palette&apos;s own accent
            </label>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-8 py-3 font-semibold text-white hover:bg-forest-900">Save colours</button>
            <button type="button" onClick={openPreview} className="min-h-[48px] rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800 hover:bg-sage-100">Preview homepage</button>
          </div>
        </div>
        <p className="max-w-xs self-end text-sm text-bark-500">Preview opens the real homepage in a new tab. It is temporary and does not change the live palette.</p>
      </div>
    </form>
  );
}