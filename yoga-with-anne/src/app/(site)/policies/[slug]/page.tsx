import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedPolicy } from "@/lib/content";
import { renderMarkdown } from "@/lib/markdown";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const policy = await getPublishedPolicy(slug);
  if (!policy) return { title: "Policy" };
  return {
    title: policy.title,
    description: `${policy.title} for Yoga with Anne.`,
    alternates: { canonical: `/policies/${slug}` },
    robots: { index: true },
  };
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const policy = await getPublishedPolicy(slug);
  if (!policy) notFound();
  const html = renderMarkdown(policy.body_md);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-4xl font-semibold text-forest-900">{policy.title}</h1>
      <p className="mt-2 text-sm text-bark-500">Version {policy.version} · last updated {new Date(policy.updated_at).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" })}</p>
      <div className="mt-8" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
