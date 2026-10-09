import Link from "next/link";
import { get } from "@/db";
import { Card } from "@/components/ui";
import { fmtDate } from "@/lib/tz";
import { getSettings } from "@/lib/settings";
import { requireAdmin, verifyPassword } from "@/lib/auth";
import { devPaymentsEnabled, isProduction } from "@/lib/runtime";
import { listMedia } from "@/lib/media";
import { getContentValue } from "@/lib/content";
import { getPrimaryVenue } from "@/lib/settings";
import { requireSuperAdminPage } from "@/lib/auth";

type CheckStatus = "ready" | "attention" | "blocker";

type LaunchCheck = {
  id: string;
  title: string;
  detail: string;
  status: CheckStatus;
  repair?: { href: string; label: string };
};

const badge: Record<CheckStatus, { label: string; cls: string }> = {
  ready: { label: "READY", cls: "bg-sage-100 text-forest-800 border-sage-300" },
  attention: { label: "NEEDS ATTENTION", cls: "bg-gold-200 text-gold-800 border-gold-200" },
  blocker: { label: "BLOCKER", cls: "bg-clay-100 text-clay-700 border-clay-600/40" },
};

/**
 * Launch readiness - THE owner's go-live gate.
 *
 * Every check lives in ONE data model; the rendered rows AND the summary
 * counts are derived from that same model, so the two can never diverge.
 * (Regression-tested in tests/e2e/admin.spec.ts.)
 */
export default async function AdminHealthPage() {
  await requireSuperAdminPage();
  const admin = await requireAdmin();
  const settings = await getSettings();
  const checks: LaunchCheck[] = [];

  // --- Environment -------------------------------------------------------
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const urlIsLocal = /localhost|127\.0\.0\.1/.test(siteUrl);
  checks.push({
    id: "site-url",
    title: "Public site address",
    detail: urlIsLocal
      ? `Currently ${siteUrl} - set NEXT_PUBLIC_SITE_URL to your real domain (needed for payment redirects, emails and social previews).`
      : `Configured: ${siteUrl}`,
    status: urlIsLocal ? (isProduction() ? "blocker" : "attention") : "ready",
  });

  // --- Admin password ----------------------------------------------------
  if (admin) {
    const hash = get<{ password_hash: string }>(`SELECT password_hash FROM admins WHERE id = ?`, admin.id)?.password_hash ?? "";
    const usingDefault = verifyPassword("change-me-immediately", hash);
    checks.push({
      id: "admin-password",
      title: "Admin password",
      detail: usingDefault
        ? "You are still using the setup password. Change it before launch."
        : "Changed from the setup default. Well done.",
      status: usingDefault ? "blocker" : "ready",
      repair: usingDefault ? { href: "/admin/settings", label: "Change password" } : undefined,
    });
  }

  // --- Payments ----------------------------------------------------------
  const stripe = !!process.env.STRIPE_SECRET_KEY;
  checks.push({
    id: "stripe",
    title: "Online payments (Stripe)",
    detail: stripe
      ? "A Stripe secret key is configured - bookings can be paid online."
      : isProduction()
        ? "No Stripe key in production - customers cannot pay online. Add STRIPE_SECRET_KEY."
        : "Not configured - the site is using the built-in test payment page, which is correct for development but must be replaced before launch.",
    status: stripe ? "ready" : isProduction() ? "blocker" : "attention",
  });
  const webhook = !!process.env.STRIPE_WEBHOOK_SECRET;
  checks.push({
    id: "stripe-webhook",
    title: "Stripe webhook",
    detail: webhook
      ? "Webhook signing secret configured - payment confirmations are verified."
      : "Without the webhook secret, Stripe payment confirmations cannot be trusted. Follow DEPLOYMENT.md.",
    status: webhook ? "ready" : "attention",
  });
  checks.push({
    id: "dev-payments",
    title: "Simulated test payments",
    detail: devPaymentsEnabled()
      ? "Enabled (development only - production builds refuse this regardless of settings)."
      : "Disabled - good. Only real Stripe Checkout is active.",
    status: devPaymentsEnabled() ? (isProduction() ? "blocker" : "attention") : "ready",
  });

  // --- Email -------------------------------------------------------------
  const resend = !!process.env.RESEND_API_KEY;
  checks.push({
    id: "email",
    title: "Email delivery",
    detail: resend
      ? "Resend is connected - customers receive real emails."
      : "No email provider connected - emails are only captured in the admin Messages log, so customers get nothing.",
    status: resend ? "ready" : isProduction() ? "blocker" : "attention",
    repair: resend ? undefined : { href: "/admin/messages", label: "Check Messages" },
  });

  // --- Cron --------------------------------------------------------------
  const cron = process.env.CRON_TOKEN;
  const cronOk = !!cron && cron !== "dev-cron-token" && cron !== "test-cron-token";
  checks.push({
    id: "cron",
    title: "Scheduled jobs (reminders)",
    detail: cronOk
      ? "CRON_TOKEN is set - schedule /api/cron/reminders?token=… every 15–30 minutes."
      : "Using a placeholder cron token - set a long random CRON_TOKEN and schedule the job (see DEPLOYMENT.md).",
    status: cronOk ? "ready" : "attention",
  });

  // --- Legal: required policies MUST be published for checkout to exist ---
  const draftRequired = get<{ c: number }>(`SELECT COUNT(*) AS c FROM policies WHERE requires_acceptance = 1 AND status != 'published'`)!.c;
  checks.push({
    id: "required-policies",
    title: draftRequired === 0 ? "Required booking terms published" : "Required booking terms not published",
    detail:
      draftRequired === 0
        ? "All policies that customers must accept at checkout are published - checkout is allowed."
        : `Checkout is BLOCKED site-wide until these are reviewed and published (${draftRequired} pending). Customers see a friendly "temporarily unavailable" message.`,
    status: draftRequired === 0 ? "ready" : "blocker",
    repair: draftRequired === 0 ? undefined : { href: "/admin/content", label: "Review policies" },
  });

  // --- Content truthfulness ---------------------------------------------
  const sampleCount = get<{ c: number }>(`SELECT COUNT(*) AS c FROM class_occurrences WHERE notes_admin LIKE 'Sample date%' AND starts_at >= datetime('now')`)!.c;
  checks.push({
    id: "sample-classes",
    title: sampleCount === 0 ? "Real class schedule" : `${sampleCount} sample class dates still in the schedule`,
    detail: sampleCount === 0 ? "No sample dates remain." : "These were generated by the setup seed. Cancel them and create your real weekly series.",
    status: sampleCount === 0 ? "ready" : "attention",
    repair: sampleCount > 0 ? { href: "/admin/classes", label: "Fix schedule" } : undefined,
  });

  const bio = await getContentValue<string>("about", "bio", "");
  const bioPlaceholder = bio.startsWith("Anne Wright teaches gentle yoga and meditation in Lucan.");
  checks.push({
    id: "about-bio",
    title: "About Anne biography",
    detail: bioPlaceholder
      ? "Still the starter text - write Anne's real biography (no invented qualifications, please)."
      : "Custom biography in place.",
    status: bioPlaceholder ? "attention" : "ready",
    repair: { href: "/admin/content", label: "Edit About" },
  });

  // --- Photos ------------------------------------------------------------
  const media = listMedia();
  checks.push({
    id: "photos",
    title: media.length === 0 ? "No photos uploaded yet" : `${media.length} photo${media.length === 1 ? "" : "s"} in the library`,
    detail:
      media.length === 0
        ? "The site currently uses elegant illustration. Upload a homepage hero and Anne's portrait for maximum warmth."
        : "Photos available - make sure the hero and portrait are chosen in Settings.",
    status: media.length === 0 ? "attention" : "ready",
    repair: { href: media.length === 0 ? "/admin/media" : "/admin/settings", label: media.length === 0 ? "Upload photos" : "Choose photos" },
  });

  // --- Venue facts -------------------------------------------------------
  const venue = await getPrimaryVenue();
  const venueMissing: string[] = [];
  if (!venue) venueMissing.push("no venue set");
  else {
    if (!venue.address) venueMissing.push("address");
    if (!venue.map_url) venueMissing.push("map link");
    if (!venue.parking_notes) venueMissing.push("parking info");
    if (!venue.access_notes) venueMissing.push("access info");
  }
  checks.push({
    id: "venue",
    title: venueMissing.length === 0 ? "Venue details verified" : `Venue details incomplete (${venueMissing.length})`,
    detail:
      venueMissing.length === 0
        ? `“${venue!.name}” has address, map, parking and access information.`
        : `Missing or unverified: ${venueMissing.join(", ")}. Parking/access claims in particular should only be added once confirmed with the venue.`,
    status: venueMissing.length === 0 ? "ready" : "attention",
    repair: { href: "/admin/venues", label: "Edit venue" },
  });

  // --- Contact details ---------------------------------------------------
  const contactMissing: string[] = [];
  if (!settings.contact_email.includes("@")) contactMissing.push("email");
  if (settings.contact_phone_display.length < 7) contactMissing.push("phone");
  checks.push({
    id: "contact",
    title: "Contact details",
    detail: contactMissing.length === 0 ? "Email and phone are set." : `Missing or short: ${contactMissing.join(", ")}.`,
    status: contactMissing.length === 0 ? "ready" : "attention",
    repair: { href: "/admin/settings", label: "Edit settings" },
  });

  // --- Jobs --------------------------------------------------------------
  const lastJob = get<{ created_at: string }>(`SELECT created_at FROM audit_log WHERE action = 'cron.ran' ORDER BY id DESC LIMIT 1`);
  const lastManual = get<{ created_at: string }>(`SELECT created_at FROM audit_log WHERE action = 'jobs.ran' ORDER BY id DESC LIMIT 1`);
  const lastRun = [lastJob?.created_at, lastManual?.created_at].filter(Boolean).sort().at(-1);
  checks.push({
    id: "jobs",
    title: "Scheduled jobs health",
    detail: lastRun
      ? `Reminders/job cycle last ran ${fmtDate(lastRun, settings.timezone)} ${new Date(lastRun).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}.`
      : "The reminder job has never run yet - normal before launch. After go-live, if this stays empty, your cron schedule isn't reaching the site.",
    status: lastRun ? "ready" : "attention",
    repair: { href: "/admin", label: "Run jobs now" },
  });

  // --- Backups -----------------------------------------------------------
  checks.push({
    id: "backups",
    title: "Backups",
    detail:
      "You can download a fresh backup below - but an automatic nightly copy (see DEPLOYMENT.md) is what actually protects the business. Test a restore once.",
    status: "attention",
    repair: { href: "/api/admin/backup", label: "Download backup now" },
  });

  // ---- Derive ALL summary counts from the same model --------------------
  const blockers = checks.filter((c) => c.status === "blocker");
  const attentions = checks.filter((c) => c.status === "attention");
  const readies = checks.filter((c) => c.status === "ready");

  const summaryLine =
    blockers.length > 0
      ? `${blockers.length} item${blockers.length === 1 ? "" : "s"} would make a production launch unsafe. Fix the red items first.`
      : attentions.length > 0
        ? `No unsafe settings detected. ${attentions.length} item${attentions.length === 1 ? "" : "s"} still need attention before launch.`
        : "Everything checks out - ready when you are.";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-forest-900">Launch readiness</h1>
        <p className="mt-2 max-w-2xl text-bark-500">
          A live checklist of everything this website needs before the real world sees it. Each item checks the actual
          current state - come back any time and it stays up to date.
        </p>
      </div>
      <div
        data-testid="health-summary"
        data-blockers={blockers.length}
        data-attention={attentions.length}
        data-ready={readies.length}
        className={
          blockers.length > 0
            ? "rounded-xl bg-clay-100 px-4 py-3 text-sm font-semibold text-clay-700"
            : attentions.length > 0
              ? "rounded-xl bg-gold-200 px-4 py-3 text-sm font-semibold text-gold-800"
              : "rounded-xl bg-sage-100 px-4 py-3 text-sm font-semibold text-forest-800"
        }
        role="status"
      >
        {summaryLine}
      </div>
      <Card className="p-6">
        <ul className="divide-y divide-oat-100">
          {checks.map((c) => (
            <li key={c.id} data-testid="health-check" data-check-id={c.id} data-status={c.status} className="flex flex-wrap items-start justify-between gap-3 border-b border-oat-100 py-4 last:border-0">
              <div className="min-w-0">
                <p className="font-semibold text-forest-900">
                  <span
                    className={`mr-2 inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-wide ${badge[c.status].cls}`}
                    aria-hidden="true"
                  >
                    {badge[c.status].label}
                  </span>
                  <span className="sr-only">{badge[c.status].label}: </span>
                  {c.title}
                </p>
                <p className="mt-0.5 text-sm text-bark-500">{c.detail}</p>
              </div>
              {c.repair ? (
                <Link href={c.repair.href} className="min-h-[40px] shrink-0 rounded-full border border-forest-800/30 px-4 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100">
                  {c.repair.label}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
