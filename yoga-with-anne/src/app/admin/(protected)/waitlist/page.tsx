import Link from "next/link";
import { all } from "@/db";
import { Card, Alert } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/tz";
import { getSettings } from "@/lib/settings";
import { offerWaitlistSeatAction, expireWaitlistAction } from "@/app/admin/actions";

export default async function AdminWaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ offered?: string; expired?: string }>;
}) {
  const { offered, expired } = await searchParams;
  const settings = await getSettings();

  const entries = all<{
    id: number; status: string; position: number; offered_at: string | null; offer_expires_at: string | null;
    c_name: string | null; c_email: string; o_title: string; o_starts: string; o_id: number;
  }>(
    `SELECT w.id, w.status, w.position, w.offered_at, w.offer_expires_at,
       c.name AS c_name, c.email AS c_email, o.title AS o_title, o.starts_at AS o_starts, o.id AS o_id
     FROM waitlist_entries w
     JOIN customers c ON c.id = w.customer_id
     JOIN class_occurrences o ON o.id = w.occurrence_id
     WHERE w.status IN ('waiting','offered') AND o.starts_at >= datetime('now')
     ORDER BY o.starts_at ASC, w.position ASC`
  );

  const byOccurrence = new Map<number, typeof entries>();
  for (const e of entries) {
    const list = byOccurrence.get(e.o_id) ?? [];
    list.push(e);
    byOccurrence.set(e.o_id, list);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-forest-900">Waitlist</h1>
        <form action={expireWaitlistAction}>
          <button type="submit" className="inline-flex min-h-[44px] items-center rounded-full border-2 border-forest-800 px-5 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100">
            Expire stale offers
          </button>
        </form>
      </div>
      {offered ? <Alert kind="success">Offer sent to the first person in the queue.</Alert> : null}
      {expired ? <Alert kind="success">Expired offers cleared and next people promoted.</Alert> : null}
      <Alert kind="info">
        When a place frees up (a cancellation or capacity change), the first waiting customer is offered it automatically with a{" "}
        {settings.waitlist_offer_hours}-hour expiry. No payment is taken while someone waits.
      </Alert>

      {byOccurrence.size === 0 ? (
        <Card className="p-8 text-center text-bark-500">Nobody is waiting for a class right now.</Card>
      ) : (
        [...byOccurrence.entries()].map(([occId, list]) => (
          <Card key={occId} className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-forest-900">{list[0].o_title}</h2>
                <p className="text-sm text-bark-500">{fmtDateTime(list[0].o_starts, list[0].o_starts, settings.timezone)}</p>
              </div>
              <div className="flex gap-3">
                <Link href={`/admin/classes/${occId}`} className="text-sm font-semibold text-forest-800 underline underline-offset-4">Manage class</Link>
                <form action={offerWaitlistSeatAction}>
                  <input type="hidden" name="occurrenceId" value={occId} />
                  <button type="submit" className="min-h-[44px] rounded-full bg-forest-800 px-5 py-2.5 text-sm font-semibold text-white">Offer next place</button>
                </form>
              </div>
            </div>
            <ol className="mt-4 divide-y divide-oat-100">
              {list.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span>
                    <span className="font-semibold text-forest-900">#{e.position} {e.c_name ?? e.c_email}</span>
                    <span className="ml-2 rounded-full bg-sage-100 px-2 py-0.5 text-xs text-forest-800">{e.status}</span>
                    {e.offer_expires_at && e.status === "offered" ? (
                      <span className="block text-xs text-clay-700">offer expires {fmtDate(e.offer_expires_at, settings.timezone)} {new Date(e.offer_expires_at).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}</span>
                    ) : null}
                  </span>
                  <span className="text-bark-500">{e.c_email}</span>
                </li>
              ))}
            </ol>
          </Card>
        ))
      )}
    </div>
  );
}
