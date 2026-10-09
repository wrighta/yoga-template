import { NextResponse } from "next/server";
import { get } from "@/db";

/** Lightweight health probe for uptime monitors and the reverse proxy. No secrets. */
export async function GET() {
  try {
    const row = get<{ c: number }>(`SELECT COUNT(*) AS c FROM settings`);
    return NextResponse.json(
      { ok: true, db: !!row, time: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
