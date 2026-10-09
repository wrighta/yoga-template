"use client";

import { useState } from "react";
import { waitlistJoin } from "../../actions";

export function WaitlistForm({ occurrenceId }: { occurrenceId: number }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-clay-600 px-6 py-3 font-semibold text-white hover:bg-clay-700"
        >
          Join the waitlist
        </button>
      ) : (
        <form action={waitlistJoin} className="flex flex-col gap-3">
          <input type="hidden" name="occurrenceId" value={occurrenceId} />
          <label className="text-sm font-semibold text-forest-900" htmlFor="wl-name">Your name</label>
          <input id="wl-name" name="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl border border-oat-300 px-4 py-3" />
          <label className="text-sm font-semibold text-forest-900" htmlFor="wl-email">Email</label>
          <input id="wl-email" name="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-xl border border-oat-300 px-4 py-3" />
          <label className="text-sm font-semibold text-forest-900" htmlFor="wl-phone">Mobile number</label>
          <input id="wl-phone" name="phone" type="tel" required autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-xl border border-oat-300 px-4 py-3" />
          <button type="submit" className="rounded-full bg-clay-600 px-6 py-3 font-semibold text-white hover:bg-clay-700 min-h-[48px]">
            Join waitlist - no payment taken
          </button>
        </form>
      )}
    </div>
  );
}
