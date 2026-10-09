import type { Metadata } from "next";
import { getPublishedFaqs } from "@/lib/content";
import { whatsappLink } from "@/lib/settings";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "FAQs",
  description: "Answers to common questions about gentle yoga classes in Lucan - beginners, what to bring, cancelling, passes and memberships.",
  alternates: { canonical: "/faqs" },
};

export default async function FaqsPage() {
  const [faqs, settings] = await Promise.all([getPublishedFaqs(), getSettings()]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-4xl font-semibold text-forest-900 sm:text-5xl">Frequently asked questions</h1>
      <p className="mt-4 text-lg text-bark-700">
        Everything people usually ask before their first class. Something missing? Just ask - details at the bottom.
      </p>
      <div className="mt-10 space-y-3">
        {faqs.map((f) => (
          <details key={f.id} className="group rounded-[var(--radius-card)] border border-oat-200 bg-white p-5 open:ring-1 open:ring-forest-700/30">
            <summary className="cursor-pointer list-none text-lg font-semibold text-forest-900">
              <span className="flex items-center justify-between gap-4">
                {f.question}
                <span aria-hidden="true" className="text-clay-700 transition group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="mt-3 leading-relaxed text-bark-700">{f.answer}</p>
          </details>
        ))}
      </div>
      <div className="mt-10 rounded-[var(--radius-card)] bg-sage-100 p-6 text-center">
        <h2 className="text-xl font-semibold text-forest-900">Still wondering about something?</h2>
        <p className="mt-2 text-bark-700">WhatsApp is the fastest way to reach Anne.</p>
        <a
          href={whatsappLink(settings)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex min-h-[48px] items-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900"
        >
          WhatsApp {settings.contact_phone_display}
        </a>
      </div>
    </div>
  );
}
