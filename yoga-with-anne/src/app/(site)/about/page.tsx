import type { Metadata } from "next";
import { ButtonLink, Card } from "@/components/ui";
import { getContent } from "@/lib/content";
import { getSettings, whatsappLink } from "@/lib/settings";
import { getMedia } from "@/lib/media";

export const metadata: Metadata = {
  title: "About Anne",
  description: "Meet Anne Wright - a warm, practical yoga teacher in Lucan offering gentle, adaptable classes for every body.",
  alternates: { canonical: "/about" },
};

export default async function AboutPage() {
  const [settings, content] = await Promise.all([getSettings(), getContent("about")]);
  const portrait = settings.portrait_media_id ? getMedia(settings.portrait_media_id) : null;
  const bio = String(content.bio ?? "");
  const approach = (content.approach as string[] | undefined) ?? [];
  const qualificationsNote = String(content.qualifications_note ?? "");

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          {portrait ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/media/${portrait.id}`}
              alt={portrait.alt || "Anne Wright"}
              width={480}
              height={576}
              className="mx-auto aspect-[5/6] w-full max-w-xs rounded-[var(--radius-card)] border border-oat-200 object-cover"
            />
          ) : (
            <>
              <svg viewBox="0 0 300 360" role="img" aria-label="Illustration - Anne's photo can be added in the admin area" className="mx-auto w-full max-w-xs rounded-[var(--radius-card)]">
                <rect width="300" height="360" rx="18" fill="var(--t100)" />
                <circle cx="150" cy="130" r="52" fill="var(--b800)" />
                <path d="M60 320 Q 150 220 240 320 L 240 360 L 60 360 Z" fill="var(--b800)" />
                <path d="M40 90 Q 150 30 260 90" stroke="var(--a500)" strokeWidth="6" fill="none" strokeLinecap="round" />
              </svg>
              <p className="mt-3 text-center text-xs text-bark-500">A photo of Anne can be added in the admin area.</p>
            </>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-bold uppercase tracking-wider text-clay-700">About</p>
          <h1 className="text-3xl font-semibold text-forest-900 sm:text-4xl">Hi, I&apos;m Anne</h1>
          <p className="mt-4 whitespace-pre-line text-lg leading-relaxed text-bark-700">{bio}</p>

          {approach.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-semibold text-forest-900">How I teach</h2>
              <ul className="mt-3 space-y-2">
                {approach.map((a, i) => (
                  <li key={i} className="flex gap-3 leading-relaxed text-bark-700">
                    <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-clay-500" />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {qualificationsNote ? (
            <Card className="mt-8 p-5">
              <h2 className="font-semibold text-forest-900">Qualifications</h2>
              <p className="mt-2 text-sm text-bark-700">{qualificationsNote}</p>
            </Card>
          ) : null}

          <Card className="mt-8 p-6">
            <h2 className="font-semibold text-forest-900">Have a question before you book?</h2>
            <p className="mt-2 text-sm text-bark-700">
              Message me on WhatsApp - I&apos;m always happy to talk through what to expect or how the class can be adapted for you.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a href={whatsappLink(settings)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[48px] items-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900">
                WhatsApp me
              </a>
              <ButtonLink href="/classes" variant="secondary">See the schedule</ButtonLink>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
