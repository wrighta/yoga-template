import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { getSettings, whatsappLink } from "@/lib/settings";
import { EnquireForm } from "./enquire-form";

export const metadata: Metadata = {
  title: "Private lessons & retreats",
  description: "Enquire about private yoga lessons, small-group sessions or custom retreats with Anne in Lucan.",
  alternates: { canonical: "/enquire" },
};

export default async function EnquirePage() {
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold text-forest-900 sm:text-5xl">Private lessons &amp; retreats</h1>
        <p className="mt-4 text-lg text-bark-700">
          One-to-one sessions, small private groups, workplace classes or a custom retreat - tell me what you have in
          mind and I&apos;ll come back with options and prices.
        </p>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <EnquireForm />

        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="font-semibold text-forest-900">What a private lesson looks like</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-bark-700">
              <li className="flex gap-2"><span aria-hidden="true" className="text-forest-700">✓</span> A session built entirely around your body, pace and goals</li>
              <li className="flex gap-2"><span aria-hidden="true" className="text-forest-700">✓</span> At the venue, your home, outdoors or online</li>
              <li className="flex gap-2"><span aria-hidden="true" className="text-forest-700">✓</span> One-to-one or a small group of friends</li>
              <li className="flex gap-2"><span aria-hidden="true" className="text-forest-700">✓</span> Ideal for beginners who&apos;d like a gentle start</li>
            </ul>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold text-forest-900">Retreats &amp; custom groups</h2>
            <p className="mt-2 text-sm leading-relaxed text-bark-700">
              Hen parties, work teams, birthdays or a full weekend retreat - tell me the group size and dates and
              I&apos;ll put something together.
            </p>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold text-forest-900">Prefer to just ask?</h2>
            <p className="mt-2 text-sm text-bark-700">WhatsApp is the fastest way to reach me.</p>
            <a
              href={whatsappLink(settings)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-[48px] items-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900"
            >
              WhatsApp {settings.contact_phone_display}
            </a>
          </Card>
        </div>
      </div>

      <p className="mt-10 text-center text-sm text-bark-500">
        Looking for regular classes instead? <Link href="/classes" className="font-semibold text-forest-800 underline underline-offset-4">See the schedule →</Link>
      </p>
    </div>
  );
}
