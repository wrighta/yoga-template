"use client";

import Link from "next/link";
import { useCart } from "./cart-provider";
import { fmtEuro } from "@/lib/money";

export type ClassCardData = {
  multiDateEligible?: boolean;
  id: number;
  title: string;
  startsAt: string;
  endsAt: string;
  display: string;
  venueName: string | null;
  instructorName: string | null;
  typeName: string;
  priceCents: number;
  remaining: number;
  capacity: number;
  state: string;
  stateLabel: string;
  bookable: boolean;
};

export function ClassCard({ data }: { data: ClassCardData }) {
  const cart = useCart();
  const selected = cart.has(data.id);
  const canSelect = data.bookable;

  return (
    <article
      data-occurrence-id={data.id}
      className={`relative flex flex-col gap-3 rounded-[var(--radius-card)] border bg-white p-5 transition ${
        selected ? "border-forest-700 ring-2 ring-forest-700" : "border-oat-200"
      } ${data.state === "cancelled" ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-forest-900">{data.title}</h3>
          <p className="mt-0.5 text-sm text-bark-500">
            {data.typeName}
            {data.instructorName ? ` · ${data.instructorName}` : ""}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${
            data.state === "available"
              ? "border-sage-300 bg-sage-100 text-forest-800"
              : data.state === "few_spaces"
                ? "border-gold-200 bg-gold-200 text-gold-800"
                : data.state === "full_waitlist"
                  ? "border-clay-200 bg-clay-100 text-clay-700"
                  : "border-oat-300 bg-oat-100 text-bark-500"
          }`}
        >
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
          {data.stateLabel}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="font-semibold text-forest-900">When</dt>
        <dd className="text-bark-700">{data.display}</dd>
        <dt className="font-semibold text-forest-900">Where</dt>
        <dd className="text-bark-700">{data.venueName ?? "Online"}</dd>
        <dt className="font-semibold text-forest-900">Price from</dt>
        <dd className="text-bark-700">{fmtEuro(data.priceCents)}{data.multiDateEligible ? " · multi-date savings available" : ""}</dd>
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
        {canSelect ? (
          <label className="inline-flex min-h-[48px] cursor-pointer items-center gap-2.5 rounded-full border-2 border-forest-800/25 px-5 py-2.5 font-semibold text-forest-800 hover:bg-sage-100 has-[:focus-visible]:ring-2">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => cart.toggle(data.id)}
              className="h-5 w-5 rounded border-oat-300 accent-forest-800"
              aria-label={`Select ${data.title} on ${data.display}`}
            />
            {selected ? "Selected ✓" : "Select"}
          </label>
        ) : null}
        {data.state === "full_waitlist" ? (
          <Link href={`/classes/${data.id}`} className="inline-flex min-h-[48px] items-center rounded-full bg-clay-600 px-5 py-2.5 font-semibold text-white hover:bg-clay-700">
            Join waitlist
          </Link>
        ) : null}
        {data.state === "cancelled" || data.state === "closed" ? null : !canSelect && data.state !== "full_waitlist" ? (
          <span className="text-sm text-bark-500">{data.stateLabel}</span>
        ) : null}
        <Link href={`/classes/${data.id}`} className="ml-auto text-sm font-semibold text-forest-800 underline underline-offset-4">
          Details
        </Link>
      </div>
    </article>
  );
}
