import Link from "next/link";
import type { BlockView, BundleView } from "@/lib/blocks";
import { fmtEuro } from "@/lib/money";

export function BlockCard({ block }: { block: BlockView }) {
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const days = block.meetingDays.map((day) => dayNames[day - 1]).filter(Boolean);
  const formatTime = (time: string) => {
    const [hourText, minuteText] = time.split(":");
    const hour = Number(hourText);
    const suffix = hour < 12 ? "AM" : "PM";
    return `${hour % 12 || 12}:${minuteText} ${suffix}`;
  };
  const blockStart = new Date(`${block.start_date}T12:00:00Z`);
  const blockEnd = new Date(`${block.end_date}T12:00:00Z`);
  const weeks = Math.max(1, Math.ceil((blockEnd.getTime() - blockStart.getTime() + 1) / (7 * 86400_000)));
  return (
    <article className="flex flex-col gap-3 rounded-[var(--radius-card)] border-2 border-forest-700 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xl font-semibold text-forest-900">{block.name}</h3>
          <p className="mt-0.5 text-sm text-bark-500">
            {block.classTypeName || block.seriesTitle}{block.venueName ? ` · ${block.venueName}` : ""}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sage-300 bg-sage-100 px-3 py-1 text-sm font-semibold text-forest-800">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
          {block.remainingSeatsMin} {block.remainingSeatsMin === 1 ? "place" : "places"} left
        </span>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-forest-900">Starts</dt><dd className="text-bark-700">{block.dates[0]?.displayDate ?? block.start_date}</dd></div>
        <div><dt className="font-semibold text-forest-900">Ends</dt><dd className="text-bark-700">{block.dates[block.dates.length - 1]?.displayDate ?? block.end_date}</dd></div>
        <div><dt className="font-semibold text-forest-900">Weeks</dt><dd className="text-bark-700">{weeks} {weeks === 1 ? "week" : "weeks"}</dd></div>
        <div><dt className="font-semibold text-forest-900">Days</dt><dd className="text-bark-700">{days.length ? days.join(" and ") : "Dates vary"}</dd></div>
        <div><dt className="font-semibold text-forest-900">Time</dt><dd className="text-bark-700">{block.startTime && block.endTime ? `${formatTime(block.startTime)} to ${formatTime(block.endTime)}` : "See class details"}</dd></div>
        <div><dt className="font-semibold text-forest-900">Location</dt><dd className="text-bark-700">{block.venueName ?? "Online"}</dd></div>
      </dl>
      <p className="font-semibold text-forest-900">{fmtEuro(block.price_cents)} for {weeks} {weeks === 1 ? "week" : "weeks"} ({block.classCount} classes in total)</p>
      <p className="text-xs text-bark-500">The price covers the full block. Missed classes are not refundable. Full dates are shown before payment.</p>

      <div className="mt-auto pt-2">
        <Link
          href={`/book?block=${block.id}`}
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900"
        >
          Book this block - {fmtEuro(block.price_cents)}
        </Link>
      </div>
    </article>
  );
}

export function BundleCard({ bundle }: { bundle: BundleView }) {
  const bestSingle = bundle.blocks.reduce((s, b) => s + b.price_cents, 0);
  const saving = bestSingle - bundle.price_cents;
  return (
    <article className="relative flex flex-col gap-3 rounded-[var(--radius-card)] border-2 border-clay-500 bg-white p-6">
      <span className="absolute -top-3 left-6 rounded-full bg-clay-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
        Best value · save {fmtEuro(saving)}
      </span>
      <div className="mt-1">
        <h3 className="text-xl font-semibold text-forest-900">{bundle.name}</h3>
        <p className="mt-0.5 text-sm text-bark-500">
          {bundle.blocks.map((b) => b.name).join(" + ")}
        </p>
      </div>
      <ul className="space-y-1 text-sm text-bark-700">
        {bundle.blocks.map((b) => (
          <li key={b.id}>
            {b.name} · {b.classCount} classes
          </li>
        ))}
        <li className="font-semibold text-forest-900">
          {bundle.classCount} classes in total
        </li>
      </ul>
      <p className="text-xs text-bark-500">The price covers all included blocks. Missed classes are not refundable. Full dates are shown before payment.</p>
      <div className="mt-auto pt-2">
        <Link
          href={`/book?bundle=${bundle.id}`}
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-clay-600 px-6 py-3 font-semibold text-white hover:bg-clay-700"
        >
          Book the bundle - {fmtEuro(bundle.price_cents)}
        </Link>
      </div>
    </article>
  );
}
