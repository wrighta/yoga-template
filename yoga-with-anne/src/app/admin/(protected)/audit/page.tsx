import { all } from "@/db";
import { Card } from "@/components/ui";
import { fmtDate } from "@/lib/tz";
import { getSettings } from "@/lib/settings";
import { requireSuperAdminPage } from "@/lib/auth";

export default async function AdminAuditPage() {
  await requireSuperAdminPage();
  const settings = await getSettings();
  const rows = all<{
    id: number; actor_type: string; actor: string | null; action: string; entity_type: string | null; entity_id: string | null; detail: string | null; created_at: string;
  }>(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 200`);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-forest-900">Audit log</h1>
      <p className="text-bark-500">Every important action - price changes, cancellations, refunds, manual bookings, settings and policy publications.</p>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-oat-100 bg-oat-50 text-left text-xs uppercase tracking-wider text-bark-500">
                <th className="px-6 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">Who</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oat-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-6 py-3 whitespace-nowrap text-bark-500">
                    {fmtDate(r.created_at, settings.timezone)} {new Date(r.created_at).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3">
                    {r.actor ?? r.actor_type}
                    <span className="block text-xs text-bark-500">{r.actor_type}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-3 max-w-md truncate text-bark-500">
                    {r.detail ?? ""} {r.entity_type ? `(${r.entity_type} ${r.entity_id ?? ""})` : ""}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="px-6 py-6 text-center text-bark-500">Nothing logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
