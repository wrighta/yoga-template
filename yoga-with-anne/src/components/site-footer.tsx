import Link from "next/link";
import { getSettings, whatsappLink, telLink, getPrimaryVenue, getWeeklyScheduleSummary } from "@/lib/settings";
import { getNavigationItems } from "@/lib/navigation";

export async function SiteFooter() {
  const [settings, venue, scheduleSummary, footerItems] = await Promise.all([getSettings(), getPrimaryVenue(), getWeeklyScheduleSummary(), getNavigationItems("footer")]);
  const socials = [
    settings.facebook_url ? { href: settings.facebook_url, label: "Facebook" } : null,
    settings.instagram_url ? { href: settings.instagram_url, label: "Instagram" } : null,
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <footer className="mt-20 border-t border-oat-200 bg-white no-print">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3">
        <div>
          <p className="font-display text-xl font-semibold text-forest-900">{settings.business_name}</p>
          <p className="mt-2 max-w-xs text-sm text-bark-500">
            Gentle yoga &amp; meditation in Lucan - a warm welcome for every body.
          </p>
          {socials.length > 0 && (
            <p className="mt-4 flex gap-4">
              {socials.map((s) => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-forest-800 underline underline-offset-4">
                  {s.label}
                </a>
              ))}
            </p>
          )}
        </div>
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-bark-500">Visit &amp; contact</h2>
          <ul className="mt-3 space-y-2 text-sm text-forest-950">
            {venue ? (
              <li>{venue.name}{venue.address ? (<><br />{venue.address}{venue.postcode ? `, ${venue.postcode}` : ""}</>) : null}</li>
            ) : null}
            {scheduleSummary ? <li>{scheduleSummary}</li> : null}
            <li>
              <a href={telLink(settings)} className="font-semibold text-forest-800 underline underline-offset-4">
                {settings.contact_phone_display}
              </a>
            </li>
            <li>
              <a href={whatsappLink(settings)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-forest-800 underline underline-offset-4">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.5 14.1c-.2.7-1.3 1.3-1.9 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.7-.6-2.9-1.3-4.8-4.2-5-4.4-.1-.2-1.2-1.6-1.2-3s.8-2.1 1-2.4c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.5.5c-.2.2-.3.4-.1.7.2.3.8 1.3 1.7 2.1 1.2 1.1 2.2 1.4 2.5 1.5.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.4 0 .1 0 .7-.2 1.3Z"/></svg>
                WhatsApp Anne
              </a>
            </li>
            <li>
              <a href={`mailto:${settings.contact_email}`} className="text-forest-800 underline underline-offset-4">{settings.contact_email}</a>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-bark-500">Information</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {footerItems.map((item) => (
              <li key={item.id}><Link href={item.href} className="text-forest-800 underline underline-offset-4">{item.label}</Link></li>
            ))}
            <li><Link href="/admin/login" className="text-bark-500 underline underline-offset-4">Staff login</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-oat-100 py-6 text-center text-xs text-bark-500">
        © {new Date().getFullYear()} {settings.business_name} · Lucan, Co. Dublin
      </div>
    </footer>
  );
}
