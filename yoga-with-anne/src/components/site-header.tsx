import Link from "next/link";
import { getSettings, whatsappLink } from "@/lib/settings";
import { getMedia } from "@/lib/media";
import { getNavigationItems } from "@/lib/navigation";
import { MobileNav } from "./mobile-nav";

export async function SiteHeader({ announcement }: { announcement?: string }) {
  const settings = await getSettings();
  const logo = settings.logo_media_id ? getMedia(settings.logo_media_id) : null;
  const nav = await getNavigationItems("primary");
  return (
    <header className="sticky top-0 z-40 border-b border-oat-200 bg-oat-50/95 backdrop-blur no-print">
      {announcement ? (
        <div className="bg-forest-800 px-4 py-2 text-center text-sm font-medium text-white">
          {announcement}
        </div>
      ) : null}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold text-forest-900">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${logo.id}`} alt="" className="h-9 w-9 rounded-lg object-cover" />
          ) : (
            <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" className="text-forest-800">
              <circle cx="15" cy="15" r="14" fill="currentColor" opacity="0.12" />
              <path d="M15 5 C 11 9, 11 13, 15 16 C 19 13, 19 9, 15 5 Z" fill="currentColor" />
              <path d="M7 20 Q 15 24 23 20" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </svg>
          )}
          <span>{settings.business_name}</span>
        </Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-6 md:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="text-sm font-semibold text-forest-900 hover:text-forest-600">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={whatsappLink(settings)}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden rounded-full border-2 border-forest-800 px-4 py-2 text-sm font-semibold text-forest-800 hover:bg-sage-100 min-h-[40px] items-center lg:inline-flex"
          >
            WhatsApp
          </a>
          <Link href="/classes" className="inline-flex items-center rounded-full bg-forest-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-forest-900 min-h-[40px]">
            Book a class
          </Link>
          <MobileNav items={nav} />
        </div>
      </div>
    </header>
  );
}
