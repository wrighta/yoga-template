import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { all } from "@/db";
import { getSettings } from "@/lib/settings";

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "bookings";
  const settings = await getSettings();

  let csv = "";
  if (type === "bookings") {
    const occurrence = url.searchParams.get("occurrence");
    const rows = all<{
      name: string | null; email: string; phone: string | null; title: string; starts_at: string;
      status: string; source: string; price_cents: number; ref: string | null; notes_admin: string | null;
    }>(
      `SELECT c.name, c.email, c.phone, o.title, o.starts_at, b.status, b.source, b.price_cents, ord.ref, b.notes_admin
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       JOIN class_occurrences o ON o.id = b.occurrence_id
       LEFT JOIN orders ord ON ord.id = b.order_id
       ${occurrence ? "WHERE b.occurrence_id = ?" : "WHERE o.starts_at >= datetime('now')"}
       ORDER BY o.starts_at ASC, c.name COLLATE NOCASE`,
      ...(occurrence ? [Number(occurrence)] : [])
    );
    csv = toCsv(
      ["name", "email", "phone", "class", "date_utc", "local_date", "status", "source", "price_eur", "order_ref", "admin_note"],
      rows.map((r) => [
        r.name, r.email, r.phone, r.title, r.starts_at,
        new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(r.starts_at)),
        r.status, r.source, (r.price_cents / 100).toFixed(2), r.ref, r.notes_admin,
      ])
    );
  } else if (type === "newsletter") {
    const rows = all<{ name: string | null; email: string; consent_at: string | null; source: string | null }>(
      `SELECT name, email, consent_at, consent_source AS source FROM customers WHERE marketing_consent = 1 ORDER BY email`
    );
    csv = toCsv(["name", "email", "consent_recorded_at", "source"], rows.map((r) => [r.name, r.email, r.consent_at, r.source]));
  } else if (type === "customers") {
    const rows = all<{ name: string | null; email: string; phone: string | null; created_at: string; marketing_consent: number }>(
      `SELECT name, email, phone, created_at, marketing_consent FROM customers WHERE anonymised = 0 ORDER BY created_at DESC`
    );
    csv = toCsv(["name", "email", "phone", "created_at", "marketing_consent"], rows.map((r) => [r.name, r.email, r.phone, r.created_at, r.marketing_consent ? "yes" : "no"]));
  } else {
    return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
