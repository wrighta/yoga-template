"use client";

import { useState } from "react";

/** One-click "copy everyone's mobile number" for emergency WhatsApp/SMS broadcasts. */
export function CopyPhoneButton({ phones }: { phones: string[] }) {
  const [copied, setCopied] = useState(false);
  const usable = phones.filter((p) => p && p.replace(/[^0-9]/g, "").length >= 7);

  if (usable.length === 0) {
    return <span className="text-xs text-bark-500">No phone numbers on this booking yet.</span>;
  }

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(usable.join(", "));
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex min-h-[40px] items-center rounded-full border border-forest-800/30 px-4 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100"
    >
      {copied ? "Copied ✓" : `Copy all ${usable.length} phone numbers`}
    </button>
  );
}
