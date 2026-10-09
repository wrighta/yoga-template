import { NextResponse } from "next/server";
import { all, get, run, nowIso } from "@/db";
import { releaseExpiredHolds, expireWaitlistOffers } from "@/lib/booking";
import { sendTemplate } from "@/lib/mail";
import { getSettings } from "@/lib/settings";
import { fmtDateTime } from "@/lib/tz";
import { audit } from "@/db";
import { safeEqual } from "@/lib/runtime";

/** Scheduled jobs: hold release, waitlist expiry, class reminders. Protect with CRON_TOKEN. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.CRON_TOKEN;
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const settings = await getSettings();

  releaseExpiredHolds();
  expireWaitlistOffers();

  const horizon = new Date(Date.now() + settings.reminder_hours * 3600 * 1000).toISOString();
  const due = all<{ id: number; occurrence_id: number; customer_id: number }>(
    `SELECT b.id, b.occurrence_id, b.customer_id FROM bookings b JOIN class_occurrences o ON o.id = b.occurrence_id
     WHERE b.status = 'confirmed' AND b.reminder_sent_at IS NULL AND o.starts_at > ? AND o.starts_at <= ? AND o.status = 'scheduled'`,
    nowIso(), horizon
  );
  let reminders = 0;
  for (const b of due) {
    const occ = get<{ title: string; starts_at: string; ends_at: string; venue_id: number | null }>(`SELECT * FROM class_occurrences WHERE id = ?`, b.occurrence_id);
    const customer = get<{ email: string; name: string | null }>(`SELECT email, name FROM customers WHERE id = ?`, b.customer_id);
    if (!occ || !customer) continue;
    const venue = occ.venue_id ? get<{ name: string; address: string | null }>(`SELECT name, address FROM venues WHERE id = ?`, occ.venue_id) : null;
    await sendTemplate("class_reminder", customer.email, {
      customer_name: customer.name ?? "there",
      class_title: occ.title,
      class_when: fmtDateTime(occ.starts_at, occ.ends_at, settings.timezone),
      venue_details: venue ? `${venue.name}${venue.address ? ", " + venue.address : ""}` : "",
    }, { relatedType: "booking", relatedId: b.id });
    run(`UPDATE bookings SET reminder_sent_at = ? WHERE id = ?`, nowIso(), b.id);
    reminders++;
  }
  audit("cron.ran", { detail: { reminders } });
  return NextResponse.json({ ok: true, reminders, expiredHolds: "released", waitlistOffers: "expired" });
}
