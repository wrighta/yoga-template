import { get, all, get as dbGet } from "@/db";
import { getSettings } from "@/lib/settings";

function icsEscape(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function buildIcs(events: { title: string; startsAt: string; endsAt: string; location?: string; description?: string; uid: string }[], name: string): string {
  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Yoga with Anne//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(name)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`,
      `DTSTART:${e.startsAt.replace(/[-:.]/g, "").slice(0, 15)}Z`,
      `DTEND:${e.endsAt.replace(/[-:.]/g, "").slice(0, 15)}Z`,
      `SUMMARY:${icsEscape(e.title)}`,
      e.location ? `LOCATION:${icsEscape(e.location)}` : null,
      e.description ? `DESCRIPTION:${icsEscape(e.description)}` : null,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.filter((l) => l !== null).join("\r\n");
}

/** One class booking → .ics (UTC-based, DST-safe). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = get<{ id: number }>(`SELECT id FROM bookings WHERE id = ?`, Number(id));
  if (!booking) return new Response("Not found", { status: 404 });
  const occ = dbGet<{ title: string; starts_at: string; ends_at: string; notes_public: string | null }>(
    `SELECT title, starts_at, ends_at, notes_public FROM class_occurrences WHERE id = (SELECT occurrence_id FROM bookings WHERE id = ?)`,
    booking.id
  )!;
  const venue = all<{ name: string; address: string | null }>(
    `SELECT v.name, v.address FROM class_occurrences o JOIN venues v ON v.id = o.venue_id WHERE o.id = (SELECT occurrence_id FROM bookings WHERE id = ?)`,
    booking.id
  )[0];
  const settings = await getSettings();
  const ics = buildIcs(
    [
      {
        uid: `booking-${booking.id}@yogawithanne`,
        title: `${occ.title} - ${settings.business_name}`,
        startsAt: occ.starts_at,
        endsAt: occ.ends_at,
        location: venue ? `${venue.name}, ${venue.address ?? ""}` : undefined,
        description: occ.notes_public ?? "Bring comfortable clothes and water.",
      },
    ],
    settings.business_name
  );
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="class-${booking.id}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST() {
  return new Response("Method not allowed", { status: 405 });
}

// keep `all` import used for venue lookup consistency
void all;
