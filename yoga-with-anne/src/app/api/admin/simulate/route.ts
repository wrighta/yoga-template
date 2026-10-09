import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { buildQuote } from "@/lib/booking";
import { getSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/ratelimit";

/** Admin-only pricing simulator: same engine as checkout, fake seats. */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!rateLimit("simulate", 60, 60_000).ok) return NextResponse.json({ error: "Slow down" }, { status: 429 });

  let body: { seats?: number; coupon?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const n = Math.max(1, Math.min(10, Number(body.seats) || 1));
  const settings = await getSettings();
  const base = Date.now() + 86400_000;
  const seats = Array.from({ length: n }, (_, i) => ({
    occurrenceId: -(i + 1),
    title: `Example class ${i + 1}`,
    startsAt: new Date(base + i * 2 * 86400_000).toISOString(),
    dateKey: new Date(base + i * 2 * 86400_000).toISOString().slice(0, 10),
    priceCents: settings.drop_in_cents,
    classTypeId: 0,
  }));
  const { result } = await buildQuote({ seats, couponCode: body.coupon ?? null });
  return NextResponse.json(result);
}
