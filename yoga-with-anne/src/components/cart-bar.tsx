"use client";

import Link from "next/link";
import { useCart } from "./cart-provider";

export function CartBar() {
  const cart = useCart();
  if (!cart.ready || cart.ids.length === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-oat-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(30,50,40,0.08)] backdrop-blur no-print">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <p className="text-sm font-semibold text-forest-900" aria-live="polite">
          {cart.ids.length} {cart.ids.length === 1 ? "class" : "classes"} selected
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={cart.clear}
            className="text-sm font-semibold text-bark-500 underline underline-offset-4"
          >
            Clear
          </button>
          <Link
            href="/book"
            className="inline-flex min-h-[48px] items-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900"
          >
            Continue to booking
          </Link>
        </div>
      </div>
    </div>
  );
}
