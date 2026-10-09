import Link from "next/link";
import type { ReactNode } from "react";

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-full bg-forest-800 px-6 py-3 text-base font-semibold text-white transition hover:bg-forest-900 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-full border-2 border-forest-800 bg-transparent px-6 py-3 text-base font-semibold text-forest-800 transition hover:bg-sage-100 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]",
  clay:
    "inline-flex items-center justify-center gap-2 rounded-full bg-clay-600 px-6 py-3 text-base font-semibold text-white transition hover:bg-clay-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]",
  small:
    "inline-flex items-center justify-center gap-1.5 rounded-full border border-forest-800/30 px-4 py-2 text-sm font-semibold text-forest-800 transition hover:bg-sage-100 min-h-[40px]",
};

export function ButtonLink({ href, children, variant = "primary", className = "" }: { href: string; children: ReactNode; variant?: keyof typeof btn; className?: string }) {
  return (
    <Link href={href} className={`${btn[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <div id={id} className={`rounded-[var(--radius-card)] border border-oat-200 bg-white shadow-[0_1px_2px_rgba(30,50,40,0.05)] ${className}`}>{children}</div>;
}

const stateStyles: Record<string, string> = {
  available: "bg-sage-100 text-forest-800 border-sage-300",
  few_spaces: "bg-gold-200 text-gold-800 border-gold-200",
  full_waitlist: "bg-clay-100 text-clay-700 border-clay-200",
  full: "bg-oat-200 text-bark-700 border-oat-300",
  cancelled: "bg-oat-200 text-bark-500 border-oat-300 line-through",
  closed: "bg-oat-200 text-bark-500 border-oat-300",
  not_open: "bg-oat-100 text-bark-500 border-oat-200",
};

export function StateBadge({ state, label }: { state: string; label: string }) {
  const style = stateStyles[state] ?? stateStyles.full;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${style}`}>
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required = false,
  autoComplete,
  defaultValue,
  value,
  onChange,
  placeholder,
  hint,
  step,
  min,
  className = "",
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  defaultValue?: string;
  /** Controlled value - survives server-action form resets so customers never re-type their details after a validation error. */
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  hint?: string;
  step?: string;
  min?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={`f-${name}`} className="text-sm font-semibold text-forest-900">
        {label} {required && <span className="text-clay-700" aria-hidden="true">*</span>}
      </label>
      <input
        id={`f-${name}`}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={value === undefined ? defaultValue : undefined}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        step={step}
        min={min}
        className="rounded-xl border border-oat-300 bg-white px-4 py-3 text-base text-forest-950 placeholder:text-bark-500 focus:border-forest-700"
      />
      {hint && <p className="text-xs text-bark-500">{hint}</p>}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="max-w-2xl">
      {eyebrow && <p className="mb-2 text-sm font-bold uppercase tracking-wider text-clay-700">{eyebrow}</p>}
      <h2 className="text-3xl font-semibold text-forest-900 sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-lg text-bark-500">{sub}</p>}
    </div>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "bg-sage-100 border-sage-300 text-forest-900",
    error: "bg-clay-100 border-clay-600 text-clay-700",
    success: "bg-sage-100 border-forest-700 text-forest-900",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-xl border-2 px-4 py-3 text-sm font-medium ${styles}`}>
      {children}
    </div>
  );
}
