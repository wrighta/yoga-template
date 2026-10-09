import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { getSettings, whatsappLink, telLink } from "@/lib/settings";
import { getContentValue } from "@/lib/content";
import { getPrimaryVenue, getWeeklyScheduleSummary } from "@/lib/settings";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Yoga with Anne - WhatsApp, phone, email or the contact form, plus venue and class details.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const [settings, intro, venue, scheduleSummary] = await Promise.all([
    getSettings(),
    getContentValue<string>("contact", "intro", "Questions? Send a message or WhatsApp Anne."),
    getPrimaryVenue(),
    getWeeklyScheduleSummary(),
  ]);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-4xl font-semibold text-forest-900 sm:text-5xl">Contact</h1>
      <p className="mt-4 max-w-xl text-lg text-bark-700">{intro}</p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <ContactForm />

        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="font-semibold text-forest-900">Fastest ways to reach Anne</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a href={whatsappLink(settings)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900">
                  WhatsApp {settings.contact_phone_display}
                </a>
              </li>
              <li>
                <a href={telLink(settings)} className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800 hover:bg-sage-100">
                  Call {settings.contact_phone_display}
                </a>
              </li>
              <li className="text-center">
                <a href={`mailto:${settings.contact_email}`} className="font-semibold text-forest-800 underline underline-offset-4">
                  {settings.contact_email}
                </a>
              </li>
            </ul>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold text-forest-900">Where we meet</h2>
            {venue ? (
              <>
                <p className="mt-2 text-sm text-bark-700">
                  {venue.name}
                  {venue.address ? (<><br />{venue.address}</>) : null}
                  {venue.postcode ? (<><br />{venue.postcode}</>) : null}
                </p>
                {venue.directions ? <p className="mt-2 text-xs text-bark-500">{venue.directions}</p> : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-bark-500">Venue details coming soon.</p>
            )}
            {scheduleSummary ? <p className="mt-3 text-sm text-bark-700">{scheduleSummary}</p> : null}
            {venue?.map_url ? (
              <a
                href={venue.map_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block font-semibold text-forest-800 underline underline-offset-4"
              >
                Directions in Google Maps →
              </a>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
