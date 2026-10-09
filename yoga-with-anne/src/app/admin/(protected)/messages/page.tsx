import { all, get } from "@/db";
import { Card, Alert, Field } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/tz";
import { sendTestEmailAction } from "@/app/admin/actions-email";
import { requireSuperAdminPage } from "@/lib/auth";

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; testsent?: string; testerror?: string }>;
}) {
  await requireSuperAdminPage();
  const { view, testsent, testerror } = await searchParams;
  const settings = await getSettings();
  const emailConfigured = !!process.env.RESEND_API_KEY;
  const messages = all<{
    id: number; to_email: string; template_key: string | null; subject: string | null; status: string;
    provider: string | null; error: string | null; created_at: string;
  }>(`SELECT id, to_email, template_key, subject, status, provider, error, created_at FROM email_log ORDER BY id DESC LIMIT 100`);
  const contactMessages = all<{ id: number; kind: string; name: string | null; email: string | null; phone: string | null; message: string; status: string; created_at: string }>(
    `SELECT * FROM contact_messages ORDER BY id DESC LIMIT 30`
  );
  const viewed = view ? get<{ subject: string | null; html: string | null; to_email: string; status: string }>(
    `SELECT subject, html, to_email, status FROM email_log WHERE id = ?`, Number(view)
  ) : null;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Messages &amp; emails</h1>
      <Alert kind={emailConfigured ? "success" : "info"}>
        {emailConfigured
          ? "Email is connected (Resend) - messages below were really sent to customers."
          : "Preview mode: no email provider is connected, so messages are safely captured here instead of being sent to real people. Add RESEND_API_KEY to go live."}
      </Alert>
      {testsent ? <Alert kind="success">Test email sent - find it below (or in the recipient's inbox if email is connected).</Alert> : null}
      {testerror ? <Alert kind="error">{testerror}</Alert> : null}

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Send a test email</h2>
        <p className="mt-1 text-sm text-bark-500">Sends a sample message through the normal pipeline so you can confirm delivery before launch.</p>
        <form action={sendTestEmailAction} className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Send to" name="to" type="email" required defaultValue={settings.contact_email} className="w-72" />
          <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900">
            Send test
          </button>
        </form>
      </Card>

      {viewed ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-forest-900">{viewed.subject}</h2>
            <a href="/admin/messages" className="text-sm font-semibold text-forest-800 underline underline-offset-4">Close preview</a>
          </div>
          <p className="text-sm text-bark-500">To: {viewed.to_email} · {viewed.status}</p>
          <iframe
            title="Email preview"
            srcDoc={viewed.html ?? ""}
            sandbox=""
            className="mt-4 h-[480px] w-full rounded-xl border border-oat-200 bg-white"
          />
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <h2 className="px-6 pt-6 text-lg font-semibold text-forest-900">Email log ({settings.checkout_enabled ? "checkout on" : "checkout paused"})</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-oat-100 bg-oat-50 text-left text-xs uppercase tracking-wider text-bark-500">
                <th className="px-6 py-3 font-semibold">Sent</th>
                <th className="px-4 py-3 font-semibold">To</th>
                <th className="px-4 py-3 font-semibold">Template</th>
                <th className="px-4 py-3 font-semibold">Subject</th>
                <th className="px-6 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oat-100">
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="px-6 py-3 text-bark-500">{fmtDate(m.created_at, settings.timezone)} {new Date(m.created_at).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-4 py-3">{m.to_email}</td>
                  <td className="px-4 py-3 font-mono text-xs">{m.template_key}</td>
                  <td className="px-4 py-3">
                    <a href={`/admin/messages?view=${m.id}`} className="font-semibold text-forest-800 underline underline-offset-4">{m.subject}</a>
                    {m.error ? <span className="block text-xs text-clay-700">{m.error.slice(0, 120)}</span> : null}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${m.status === "sent" ? "bg-forest-800 text-white" : m.status === "failed" ? "bg-clay-100 text-clay-700" : m.status === "suppressed" ? "bg-oat-200 text-bark-500" : "bg-gold-200 text-gold-700"}`}>
                      {m.status}
                    </span>
                  </td>
                </tr>
              ))}
              {messages.length === 0 && <tr><td colSpan={5} className="px-6 py-6 text-center text-bark-500">No emails yet. Book a class to see the confirmation appear here.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <h2 className="px-6 pt-6 text-lg font-semibold text-forest-900">Contact form messages</h2>
        <ul className="mt-4 divide-y divide-oat-100 px-6 pb-6">
          {contactMessages.map((m) => (
            <li key={m.id} className="py-4">
              {m.kind === "enquiry" ? <span className="mr-2 rounded-full bg-clay-100 px-2 py-0.5 text-xs font-bold text-clay-700">Enquiry</span> : null}
              <p className="font-semibold text-forest-900">{m.name} <span className="font-normal text-bark-500">· {m.email}{m.phone ? ` · ${m.phone}` : ""}</span></p>
              <p className="mt-1 text-bark-700">{m.message}</p>
              <p className="mt-1 text-xs text-bark-500">{fmtDate(m.created_at, settings.timezone, true)}</p>
            </li>
          ))}
          {contactMessages.length === 0 && <li className="py-4 text-sm text-bark-500">No contact messages yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
