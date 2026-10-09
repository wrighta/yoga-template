import { CartProvider } from "@/components/cart-provider";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { getSettings } from "@/lib/settings";
import { getPublishedPolicy } from "@/lib/content";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [settings, policiesReady] = await Promise.all([
    getSettings(),
    getPublishedPolicy("booking-terms").then((p) => !!p),
  ]);
  if (settings.maintenance_mode) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-display text-3xl font-semibold text-forest-900">{settings.business_name}</h1>
        <p className="text-lg text-bark-500">
          We&apos;re making a few changes and will be back shortly. To book or ask a question, message Anne on {settings.contact_phone_display}.
        </p>
      </div>
    );
  }
  return (
    <CartProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-forest-800 focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <SiteHeader announcement={settings.announcement || undefined} />
      <main id="main">{children}</main>
      <SiteFooter />
      {policiesReady ? null : (
        <aside aria-label="Site notice" className="border-t border-oat-200 bg-gold-200 px-4 py-2 text-center text-xs font-semibold text-gold-800 no-print">
          Preview build - legal policy pages are still drafts awaiting review.
        </aside>
      )}
    </CartProvider>
  );
}
