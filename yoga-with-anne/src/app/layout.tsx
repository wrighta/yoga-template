import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
import "./globals.css";
import { getSettings } from "@/lib/settings";
import { HydrationMarker } from "@/components/hydration-marker";
import { appearanceCss } from "@/lib/appearance";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const ogImage = settings.og_media_id
    ? [{ url: `/api/media/${settings.og_media_id}`, width: 1200, height: 630, alt: settings.business_name }]
    : [{ url: `/api/og?title=${encodeURIComponent(settings.tagline)}`, width: 1200, height: 630, alt: settings.business_name }];
  return {
    metadataBase: new URL(base),
    title: {
      default: `${settings.business_name} - Gentle Yoga & Meditation in Lucan`,
      template: `%s · ${settings.business_name}`,
    },
    description:
      "Gentle yoga and meditation classes in Lucan, Co. Dublin. All levels welcome",
    openGraph: {
      type: "website",
      locale: "en_IE",
      siteName: settings.business_name,
      images: ogImage,
    },
    twitter: {
      card: "summary_large_image",
      images: ogImage.map((i) => i.url),
    },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const css = await appearanceCss();
  return (
    <html lang="en-IE">
      <body>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <HydrationMarker />
        {children}
      </body>
    </html>
  );
}
