import { getSettings } from "@/lib/settings";
import { listMedia } from "@/lib/media";
import { Card, Alert, Field } from "@/components/ui";
import { MediaPicker } from "@/components/media-picker";
import { saveSettingsAction, changePasswordAction } from "@/app/admin/actions";
import { createTeamMemberAction, deleteTeamMemberAction, updateTeamMemberRoleAction } from "@/app/admin/actions-services";
import { all } from "@/db";
import { requireSuperAdminPage, requireAdmin, canAdminister, adminRoleLabel } from "@/lib/auth";

async function requireSuperAdminCapture() {
  const a = await requireAdmin();
  if (a && !canAdminister(a.role)) return null;
  return a;
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; password?: string; error?: string }>;
}) {
  await requireSuperAdminPage();
  const sp = await searchParams;
  const me = await requireSuperAdminCapture();
  const team = me ? all<{ id: number; name: string; email: string; role: string }>(`SELECT id, name, email, role FROM admins ORDER BY id`) : [];
  const adminId = me?.id ?? 0;
  const [s, media] = await Promise.all([getSettings(), listMedia()]);
  const pickerMedia = media.map((m) => ({ id: m.id, alt: m.alt, mime: m.mime }));
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Settings</h1>
      {sp.saved ? <Alert kind="success">Settings saved.</Alert> : null}
      {sp.password ? <Alert kind="success">Password changed.</Alert> : null}
      {sp.error ? <Alert kind="error">{sp.error}</Alert> : null}

      <form action={saveSettingsAction}>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">Business details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Business name" name="business_name" defaultValue={s.business_name} required />
            <Field label="Contact email" name="contact_email" type="email" defaultValue={s.contact_email} required />
            <Field label="Phone (shown to customers)" name="contact_phone_display" defaultValue={s.contact_phone_display} required />
            <Field label="International phone (for WhatsApp links)" name="phone_intl" defaultValue={s.phone_intl} required hint="Digits and + only, e.g. +353877639701" />
            <Field label="WhatsApp pre-filled greeting" name="whatsapp_greeting" defaultValue={s.whatsapp_greeting} className="sm:col-span-2" />
            <Field label="Facebook URL (optional)" name="facebook_url" defaultValue={s.facebook_url} />
            <Field label="Instagram URL (optional)" name="instagram_url" defaultValue={s.instagram_url} />
            <Field label="Homepage announcement (leave blank to hide the bar)" name="announcement" defaultValue={s.announcement} className="sm:col-span-2" />
            <Field label="Tax note shown on the prices page (see your accountant - leave blank if unsure)" name="tax_note" defaultValue={s.tax_note} className="sm:col-span-2" />
          </div>

          <h2 className="mt-8 border-t border-oat-100 pt-6 text-lg font-semibold text-forest-900">Photos</h2>
          <p className="mt-1 text-sm text-bark-500">Upload photos on the “Photos &amp; images” page first, then choose them here.</p>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <MediaPicker name="hero_media_id" label="Homepage hero photo" media={pickerMedia} currentId={s.hero_media_id} help="Shown beside the headline. Until you add one, a calm illustration is used." />
            <MediaPicker name="portrait_media_id" label="Anne's portrait" media={pickerMedia} currentId={s.portrait_media_id} help="Shown on the homepage and About page." />
            <MediaPicker name="logo_media_id" label="Logo (optional)" media={pickerMedia} currentId={s.logo_media_id} help="Replaces the small leaf mark in the header. A square image works best." />
            <MediaPicker name="og_media_id" label="Social sharing image (optional)" media={pickerMedia} currentId={s.og_media_id} help="Shown when the site is shared on WhatsApp/Facebook. A branded image is generated automatically if you leave this empty." />
          </div>

          <h2 className="mt-8 border-t border-oat-100 pt-6 text-lg font-semibold text-forest-900">Booking rules</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Free cancellation cutoff (hours before class)" name="cancellation_cutoff_hours" type="number" defaultValue={String(s.cancellation_cutoff_hours)} />
            <Field label="Checkout seat hold (minutes)" name="hold_minutes" type="number" defaultValue={String(s.hold_minutes)} hint="How long someone's places are reserved during payment" />
            <Field label="Class reminder (hours before class)" name="reminder_hours" type="number" defaultValue={String(s.reminder_hours)} />
            <Field label="Waitlist offer expiry (hours)" name="waitlist_offer_hours" type="number" defaultValue={String(s.waitlist_offer_hours)} />
          </div>

          <h2 className="mt-8 border-t border-oat-100 pt-6 text-lg font-semibold text-forest-900">Site status</h2>
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex items-start gap-3 text-sm text-bark-700">
              <input type="checkbox" name="checkout_enabled" defaultChecked={s.checkout_enabled} className="mt-1 h-5 w-5 rounded accent-forest-800" />
              <span><strong>Online checkout enabled.</strong> Turn off to pause new online bookings (e.g. over Christmas) while keeping the site visible.</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-bark-700">
              <input type="checkbox" name="class_passes_enabled" defaultChecked={s.class_passes_enabled} className="mt-1 h-5 w-5 rounded accent-forest-800" />
              <span><strong>Class passes enabled.</strong> Allow customers to buy class-credit passes and book each class separately. Leave off if this business sells drop-ins and blocks only.</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-bark-700">
              <input type="checkbox" name="multi_date_discount_enabled" defaultChecked={s.multi_date_discount_enabled} className="mt-1 h-5 w-5 rounded accent-forest-800" />
              <span><strong>Multi-date drop-in discount enabled.</strong> Allow an automatic lower per-class price when customers book separate dates. Leave off when only blocks and bundles should have combined pricing.</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-bark-700">
              <input type="checkbox" name="memberships_enabled" defaultChecked={s.memberships_enabled} className="mt-1 h-5 w-5 rounded accent-forest-800" />
              <span><strong>Memberships enabled.</strong> Show monthly/annual memberships on the Prices page and allow recurring sign-ups. Class passes and multi-date discounts use their separate switches above.</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-bark-700">
              <input type="checkbox" name="maintenance_mode" defaultChecked={s.maintenance_mode} className="mt-1 h-5 w-5 rounded accent-forest-800" />
              <span><strong>Maintenance mode.</strong> Replaces the public site with a short notice. The admin area stays available.</span>
            </label>
          </div>

          <button type="submit" className="mt-8 min-h-[48px] rounded-full bg-forest-800 px-8 py-3 font-semibold text-white hover:bg-forest-900">
            Save all settings
          </button>
        </Card>
      </form>

      <Card className="p-6" id="team">
        <h2 className="text-lg font-semibold text-forest-900">Team</h2>
        <p className="mt-1 text-sm text-bark-500">
          <strong>Teacher-owners</strong> run offerings, pricing and bookings. <strong>Super Admins</strong> manage the website, team, content, appearance and integrations.
        </p>
        <ul className="mt-4 divide-y divide-oat-100">
          {team.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span>
                <span className="font-semibold text-forest-900">{t.name}</span>
                <span className="text-bark-500"> · {t.email}</span>
              </span>
              <span className="flex items-center gap-3">
                {t.id !== adminId ? (
                  <>
                    <form action={updateTeamMemberRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <select name="role" defaultValue={canAdminister(t.role as Parameters<typeof canAdminister>[0]) ? "super_admin" : "teacher_owner"} aria-label={`Role for ${t.name}`} className="rounded-lg border border-oat-300 px-2 py-1 text-xs">
                        <option value="super_admin">Super Admin</option>
                        <option value="teacher_owner">Teacher-owner</option>
                      </select>
                      <button type="submit" className="text-xs font-semibold text-forest-800 underline underline-offset-4">Save role</button>
                    </form>
                    <form action={deleteTeamMemberAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="text-xs font-semibold text-clay-700 underline underline-offset-4">Remove</button>
                    </form>
                  </>
                ) : (
                  <span className="rounded-full bg-sage-100 px-2 py-0.5 text-xs font-semibold text-forest-800">{adminRoleLabel(t.role as Parameters<typeof adminRoleLabel>[0])} · you</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <details className="mt-4 rounded-xl border border-dashed border-oat-300 p-4">
          <summary className="cursor-pointer font-semibold text-forest-900">+ Add a team member</summary>
          <form action={createTeamMemberAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Name" name="name" required />
            <Field label="Email" name="email" type="email" required />
            <Field label="Password (min 8 characters)" name="password" type="password" required autoComplete="new-password" />
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
              Role
              <select name="role" className="rounded-xl border border-oat-300 bg-white px-4 py-3 text-base">
                <option value="teacher_owner">Teacher-owner (business operations)</option>
                <option value="super_admin">Super Admin (website setup and configuration)</option>
              </select>
            </label>
            <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white sm:col-span-2">Create account</button>
          </form>
        </details>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Change my password</h2>
        <form action={changePasswordAction} className="mt-4 grid max-w-md gap-4">
          <Field label="Current password" name="current" type="password" required autoComplete="current-password" />
          <Field label="New password (min 10 characters)" name="next" type="password" required autoComplete="new-password" />
          <button type="submit" className="min-h-[44px] w-fit rounded-full bg-forest-800 px-6 py-2.5 font-semibold text-white">Change password</button>
        </form>
      </Card>
    </div>
  );
}
