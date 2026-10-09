import { get, run, nowIso } from "@/db";

export type TemplateVars = Record<string, string>;

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Template variables are ESCAPED TEXT by default.
 * A variable is inserted as raw HTML only when its name ends in `_html`
 * (e.g. class_details_html) - reserved for internally generated fragments.
 */
function render(tpl: string, vars: TemplateVars): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key] ?? "";
    return key.endsWith("_html") ? value : escapeHtml(value);
  });
}

function wrapHtml(heading: string, bodyHtml: string, settingsName: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f3ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2a3a2e;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5ded0;">
      <div style="background:#2f4a3c;padding:20px 28px;">
        <span style="color:#f3efe6;font-size:18px;font-weight:600;">${settingsName}</span>
      </div>
      <div style="padding:28px;">
        <h1 style="margin:0 0 16px;font-size:20px;color:#2f4a3c;">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:16px 28px;border-top:1px solid #eee6d8;color:#7a7a6e;font-size:12px;">
        Sent by ${settingsName}. If you have any questions, just reply to this email.
      </div>
    </div>
  </div></body></html>`;
}

function toText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Send (or preview) a transactional email. Never throws - failures are logged.
 * Without RESEND_API_KEY, messages land in the dev preview log (status 'preview').
 */
export async function sendTemplate(
  key: string,
  to: string,
  vars_in: TemplateVars,
  opts: { relatedType?: string; relatedId?: number } = {}
): Promise<void> {
  try {
    const tpl = get<{ subject: string; heading: string | null; body_html: string }>(
      `SELECT subject, heading, body_html FROM email_templates WHERE key = ?`,
      key
    );
    if (!tpl) {
      run(
        `INSERT INTO email_log (to_email, template_key, subject, status, error, created_at) VALUES (?,?,?,?,?,?)`,
        to,
        key,
        `(missing template ${key})`,
        "failed",
        `No email template with key "${key}"`,
        nowIso()
      );
      return;
    }
    const { getSettings } = await import("./settings");
    const settings = await getSettings();
    // every template can rely on these basic placeholders
    const vars: TemplateVars = {
      business_name: settings.business_name,
      contact_phone: settings.contact_phone_display,
      contact_email: settings.contact_email,
      ...vars_in,
    };
    const subject = render(tpl.subject, vars);
    const bodyHtml = render(tpl.body_html, vars);
    const html = wrapHtml(render(tpl.heading ?? subject, vars), bodyHtml, settings.business_name);
    const text = toText(bodyHtml);

    // Duplicate-send guard: same template, recipient and related record within
    // 60 seconds is almost always a retry race - skip and log as suppressed.
    if (opts.relatedType && opts.relatedId) {
      const recent = get<{ id: number }>(
        `SELECT id FROM email_log WHERE to_email = ? AND template_key = ? AND related_type = ? AND related_id = ? AND created_at > ? LIMIT 1`,
        to,
        key,
        opts.relatedType,
        opts.relatedId,
        new Date(Date.now() - 60_000).toISOString()
      );
      if (recent) {
        run(
          `INSERT INTO email_log (to_email, template_key, subject, status, provider, related_type, related_id, created_at)
           VALUES (?,?,?, 'suppressed', 'dedupe', ?, ?, ?)`,
          to, key, subject, opts.relatedType ?? null, opts.relatedId ?? null, nowIso()
        );
        return;
      }
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM || `Yoga with Anne <onboarding@resend.dev>`;
    if (apiKey) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, html, text }),
        });
        if (res.ok) {
          run(
            `INSERT INTO email_log (to_email, template_key, subject, html, text, status, provider, related_type, related_id, created_at)
             VALUES (?,?,?,?,?,'sent','resend',?,?,?)`,
            to, key, subject, html, text, opts.relatedType ?? null, opts.relatedId ?? null, nowIso()
          );
          return;
        }
        const errText = await res.text();
        run(
          `INSERT INTO email_log (to_email, template_key, subject, html, text, status, provider, error, related_type, related_id, created_at)
           VALUES (?,?,?,?,?,'failed','resend',?,?,?,?)`,
          to, key, subject, html, text, errText.slice(0, 500), opts.relatedType ?? null, opts.relatedId ?? null, nowIso()
        );
        return;
      } catch (e) {
        run(
          `INSERT INTO email_log (to_email, template_key, subject, html, text, status, provider, error, related_type, related_id, created_at)
           VALUES (?,?,?,?,?,'failed','resend',?,?,?,?)`,
          to, key, subject, html, text, String(e).slice(0, 500), opts.relatedType ?? null, opts.relatedId ?? null, nowIso()
        );
        return;
      }
    }
    run(
      `INSERT INTO email_log (to_email, template_key, subject, html, text, status, provider, related_type, related_id, created_at)
       VALUES (?,?,?,?,?,'preview','dev-log',?,?,?)`,
      to, key, subject, html, text, opts.relatedType ?? null, opts.relatedId ?? null, nowIso()
    );
  } catch (e) {
    console.error("[mail] failed to send template", key, e);
  }
}
