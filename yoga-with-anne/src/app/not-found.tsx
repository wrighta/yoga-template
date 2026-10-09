import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <svg width="56" height="56" viewBox="0 0 30 30" aria-hidden="true" className="text-forest-800">
        <circle cx="15" cy="15" r="14" fill="currentColor" opacity="0.12" />
        <path d="M15 5 C 11 9, 11 13, 15 16 C 19 13, 19 9, 15 5 Z" fill="currentColor" />
        <path d="M7 20 Q 15 24 23 20" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
      <h1 className="font-display text-3xl font-semibold text-forest-900">We couldn&apos;t find that page</h1>
      <p className="max-w-md text-bark-700">
        The link may be old or mistyped. The class schedule and everything else is one tap away - or get in touch through the contact page and we&apos;ll point you in the right direction.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="inline-flex min-h-[48px] items-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900">
          Back to homepage
        </Link>
        <Link href="/classes" className="inline-flex min-h-[48px] items-center rounded-full border-2 border-forest-800 px-6 py-3 font-semibold text-forest-800 hover:bg-sage-100">
          See the class schedule
        </Link>
      </div>
    </div>
  );
}
