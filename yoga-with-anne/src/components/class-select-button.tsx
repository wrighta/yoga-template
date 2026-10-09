"use client";

import { useRouter } from "next/navigation";
import { useCart } from "./cart-provider";

/** Selects a class in the cart and goes straight to booking. */
export function ClassSelectButton({ occurrenceId, label }: { occurrenceId: number; label: string }) {
  const cart = useCart();
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (!cart.has(occurrenceId)) cart.toggle(occurrenceId);
        router.push("/book");
      }}
      className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900"
    >
      {cart.has(occurrenceId) ? "Continue to booking" : "Book this class"}
      <span className="sr-only"> - {label}</span>
    </button>
  );
}
