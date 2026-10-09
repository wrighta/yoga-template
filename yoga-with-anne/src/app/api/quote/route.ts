import { NextResponse } from "next/server";
import { buildQuote } from "@/lib/booking";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { requireCustomer } from "@/lib/auth";
import { activeHoldCount, confirmedCount, getOccurrenceView } from "@/lib/schedule";
import { getSettings } from "@/lib/settings";
import { all } from "@/db";

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`quote:${ip}`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Slow down a little." }, { status: 429 });

  let body: { occurrenceIds?: unknown; coupon?: unknown; blockId?: unknown; bundleId?: unknown; attendeeCount?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const coupon = typeof body.coupon === "string" ? body.coupon.trim() || null : null;
  const customer = await requireCustomer();

  // ---- block / bundle mode: single-line authoritative pricing ----
  const blockId = Number(body.blockId) || null;
  const bundleId = Number(body.bundleId) || null;
  if (blockId || bundleId) {
    const { getBlockView, getBundleView } = await import("@/lib/blocks");
    if (blockId) {
      const view = await getBlockView(blockId);
      if (!view || !view.active || !view.onSale || view.publication_status !== "published" || view.seriesPublicationStatus !== "published") return NextResponse.json({ error: "This block is not available for booking." }, { status: 404 });
      const bookable = view.dates.filter((d) => d.status === "scheduled" && new Date(d.startsAt) > new Date());
      const isEvent = view.kind === "workshop" || view.kind === "retreat";
      const attendeeCount = isEvent && Number.isInteger(body.attendeeCount) ? Math.max(1, Math.min(20, Number(body.attendeeCount))) : 1;
      if (isEvent && bookable.length === 1) {
        const eventDate = bookable[0];
        const remaining = eventDate.capacity - confirmedCount(eventDate.occurrenceId) - activeHoldCount(eventDate.occurrenceId);
        if (attendeeCount > remaining) return NextResponse.json({ error: `Only ${remaining} place${remaining === 1 ? "" : "s"} remain for this event.` }, { status: 409 });
      }
      const totalCents = view.price_cents * attendeeCount;
      const per = Math.floor(totalCents / Math.max(1, bookable.length));
      const rem = totalCents - per * bookable.length;
      const result = {
        seats: bookable.map((d, i) => ({ occurrenceId: d.occurrenceId, source: "paid", priceCents: per + (i < rem ? 1 : 0) })),
        lines: [{ kind: "block", description: isEvent ? `${view.name} - ${attendeeCount} attendee${attendeeCount === 1 ? "" : "s"}` : `${view.name} - ${bookable.length} classes`, qty: attendeeCount, unitCents: view.price_cents, totalCents }],
        subtotalCents: totalCents,
        discountCents: 0,
        totalCents,
        chosen: { kind: "block", label: view.name, explanation: isEvent ? `One payment reserves ${attendeeCount} place${attendeeCount === 1 ? "" : "s"} for the whole event.` : `One payment books you into all ${bookable.length} dates. Non-refundable.` },
        alternatives: [],
      };
      const datesHtml = bookable.map((d) => d.displayDate).join(" · ");
      return NextResponse.json({
        result,
          blockMode: {
            name: view.name,
            kind: view.kind,
            description: view.description,
            venueName: view.venueName,
            classCount: view.classCount,
            dates: isEvent ? "" : datesHtml,
            rangeLabel: isEvent
              ? `${view.start_date} – ${view.end_date}`
              : bookable.length ? `${bookable[0].displayDate} – ${bookable[bookable.length - 1].displayDate}` : "",
            remainingCapacity: isEvent && bookable[0]
              ? bookable[0].capacity - confirmedCount(bookable[0].occurrenceId) - activeHoldCount(bookable[0].occurrenceId)
              : null,
          },
        signedIn: !!customer,
      });
    }
    if (bundleId == null) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const view = await getBundleView(bundleId);
    if (!view || !view.active || !view.published) return NextResponse.json({ error: "This bundle is not available for booking." }, { status: 404 });
    const { bundleOccurrences } = await import("@/lib/blocks");
    const parts = bundleOccurrences(bundleId).filter((p) => p.occurrenceIds.length > 0);
    const allIds = parts.flatMap((p) => p.occurrenceIds);
    const dateRows = all<{ id: number; starts_at: string }>(`SELECT id, starts_at FROM class_occurrences WHERE id IN (${allIds.map(() => "?").join(",")}) AND starts_at > ? AND status = 'scheduled'`, ...allIds, new Date().toISOString());
    const per = Math.floor(view.price_cents / Math.max(1, dateRows.length));
    const rem = view.price_cents - per * dateRows.length;
    const result = {
      seats: dateRows.map((r, i) => ({ occurrenceId: r.id, source: "paid", priceCents: per + (i < rem ? 1 : 0) })),
      lines: [
        { kind: "bundle", description: `${view.name} - ${parts.length} blocks, ${dateRows.length} classes`, qty: 1, unitCents: view.price_cents, totalCents: view.price_cents },
        ...parts.map((p) => ({ kind: "block", description: `includes ${p.blockName}`, qty: 1, unitCents: 0, totalCents: 0 })),
      ],
      subtotalCents: view.price_cents,
      discountCents: 0,
      totalCents: view.price_cents,
      chosen: { kind: "bundle", label: view.name, explanation: `One payment covers ${parts.length} blocks (${dateRows.length} classes). Non-refundable.` },
      alternatives: [],
    };
    return NextResponse.json({
      result,
      blockMode: { name: view.name, venueName: null, classCount: dateRows.length, dates: "", rangeLabel: `${parts.length} blocks included` },
      signedIn: !!customer,
    });
  }

  const ids = Array.isArray(body.occurrenceIds)
    ? body.occurrenceIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 12)
    : [];
  if (ids.length === 0) return NextResponse.json({ empty: true });

  const settings = await getSettings();
  const views = await Promise.all(ids.map((id) => getOccurrenceView(id)));
  if (views.some((v) => !v)) return NextResponse.json({ error: "A selected class no longer exists." }, { status: 404 });


  const { result } = await buildQuote({
    seats: views.map((v) => ({
      occurrenceId: v!.id,
      title: `${v!.title} - ${v!.display}`,
      startsAt: v!.starts_at,
      dateKey: v!.starts_at.slice(0, 10),
      priceCents: v!.effective_price_cents,
      classTypeId: v!.class_type_id,
    })),
    customerId: customer?.id ?? null,
    couponCode: coupon,
  });
  const entitlements = customer
    ? await all<{ n: number }>(`SELECT COUNT(*) AS n FROM passes WHERE customer_id = ?`, customer.id)
    : null;

  return NextResponse.json({
    result,
    customerName: customer?.name ?? null,
    signedIn: !!customer,
    classPassesEnabled: settings.class_passes_enabled,
    hasPasses: !!entitlements && entitlements[0].n > 0,
    holdMinutes: settings.hold_minutes,
    contactPhone: settings.contact_phone_display,
  });
}
