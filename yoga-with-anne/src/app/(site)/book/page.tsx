import type { Metadata } from "next";
import { Suspense } from "react";
import { requireCustomer } from "@/lib/auth";
import { BookFlow } from "./book-flow";
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Review & book", robots: { index: false } };

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; block?: string; bundle?: string }>;
}) {
  const { cancelled, block, bundle } = await searchParams;
  const customer = await requireCustomer();
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-3xl font-semibold text-forest-900 sm:text-4xl">Review &amp; book</h1>
      {cancelled ? (
        <div className="mt-4">
          <Alert>Payment wasn&apos;t completed - your places weren&apos;t booked. You can try again below.</Alert>
        </div>
      ) : null}
      <div className="mt-8">
        <Suspense fallback={<p className="text-bark-500">Loading your selection…</p>}>
          <BookFlow signedIn={!!customer} customerId={customer?.id ?? null} customerName={customer?.name ?? null} customerEmail={customer?.email ?? null} blockId={block ? Number(block) : null} bundleId={bundle ? Number(bundle) : null} />
        </Suspense>
      </div>
    </div>
  );
}
