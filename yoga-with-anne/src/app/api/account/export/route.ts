import { NextResponse } from "next/server";
import { all, get } from "@/db";
import { requireCustomer } from "@/lib/auth";

/** GDPR: signed-in customer can download everything we hold about them (JSON). */
export async function GET() {
  const customer = await requireCustomer();
  if (!customer) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const profile = get<{ id: number; email: string; name: string | null; phone: string | null; marketing_consent: number; consent_at: string | null; created_at: string }>(
    `SELECT id, email, name, phone, marketing_consent, consent_at, created_at FROM customers WHERE id = ?`,
    customer.id
  );
  const bookings = all<{ title: string; starts_at: string; status: string; price_cents: number; created_at: string }>(
    `SELECT o.title, o.starts_at, b.status, b.price_cents, b.created_at
     FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id
     WHERE b.customer_id = ? ORDER BY o.starts_at DESC`,
    customer.id
  );
  const orders = all<{ ref: string; status: string; total_cents: number; created_at: string }>(
    `SELECT ref, status, total_cents, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC`,
    customer.id
  );
  const passes = all<{ product: string; credits_total: number; expires_at: string; status: string }>(
    `SELECT pr.name AS product, p.credits_total, p.expires_at, p.status
     FROM passes p JOIN products pr ON pr.id = p.product_id WHERE p.customer_id = ?`,
    customer.id
  );
  const memberships = all<{ product: string; status: string; current_period_end: string | null }>(
    `SELECT pr.name AS product, m.status, m.current_period_end
     FROM memberships m JOIN products pr ON pr.id = m.product_id WHERE m.customer_id = ?`,
    customer.id
  );

  const payload = {
    generated_at: new Date().toISOString(),
    business: "Yoga with Anne",
    note: "This file contains all personal data Yoga with Anne holds about you. To correct or delete it, email hello@yogawithanne.ie.",
    profile,
    bookings,
    orders,
    passes,
    memberships,
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="my-data-yoga-with-anne.json"`,
      "Cache-Control": "no-store",
    },
  });
}
