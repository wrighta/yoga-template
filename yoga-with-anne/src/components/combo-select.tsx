"use client";

import { useState } from "react";

/**
 * Dropdown that doubles as a free-text field: teachers either pick an existing
 * option or choose "＋ Type a new one…" which immediately swaps to a focused
 * text input - one click, then typing. Posts a single input `name` whose
 * value is either the existing id or the typed name.
 */
export function ComboSelect({
  label,
  name,
  options,
  allowNew = true,
  newPlaceholder,
  hint,
  required = false,
  extraNewField,
  defaultSelected,
}: {
  label: string;
  name: string;
  options: { id: number; name: string }[];
  allowNew?: boolean;
  newPlaceholder: string;
  hint?: string;
  required?: boolean;
  /** Optional second field shown only in new mode (e.g. a Google Maps link for a new venue). */
  extraNewField?: { name: string; label: string; placeholder: string };
  /** Preselect an existing option (e.g. the seeded venue). */
  defaultSelected?: number;
}) {
  const [mode, setMode] = useState<"select" | "new">(options.length === 0 && allowNew ? "new" : "select");
  const [text, setText] = useState("");

  if (mode === "new") {
    return (
      <div data-combo={name} className="flex flex-col gap-1.5">
        <label className="text-sm font-semibold text-forest-900">
          {label} {required && <span className="text-clay-700" aria-hidden="true">*</span>}
        </label>
        <input
          name={name}
          type="text"
          required={required}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={newPlaceholder}
          className="rounded-xl border border-oat-300 bg-white px-4 py-3 text-base"
        />
        {extraNewField ? (
          <>
            <label className="mt-1 text-sm font-semibold text-forest-900">{extraNewField.label}</label>
            <input
              name={extraNewField.name}
              type="url"
              placeholder={extraNewField.placeholder}
              className="rounded-xl border border-oat-300 bg-white px-4 py-3 text-base"
            />
          </>
        ) : null}
        {options.length > 0 && (
          <button
            type="button"
            onClick={() => setMode("select")}
            className="w-fit text-xs font-semibold text-forest-800 underline underline-offset-4"
          >
            ← choose from your list instead
          </button>
        )}
        {hint ? <p className="text-xs text-bark-500">{hint}</p> : null}
      </div>
    );
  }

  return (
    <div data-combo={name} className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-forest-900">
        {label} {required && <span className="text-clay-700" aria-hidden="true">*</span>}
      </label>
      <select
        name={name}
        required={required}
        className="rounded-xl border border-oat-300 bg-white px-4 py-3 text-base"
        onChange={(e) => {
          if (e.target.value === "__new__") setMode("new");
        }}
        defaultValue={defaultSelected ? String(defaultSelected) : ""}
      >
        <option value="" disabled>
          Choose…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        {allowNew && <option value="__new__">＋ Type a new one - starts typing</option>}
      </select>
      {hint ? <p className="text-xs text-bark-500">{hint}</p> : null}
    </div>
  );
}
