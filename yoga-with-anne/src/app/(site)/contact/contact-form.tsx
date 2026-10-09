"use client";

import { useActionState, useState } from "react";
import { contactSubmit } from "../actions";
import { Alert, Field } from "@/components/ui";
import { Card } from "@/components/ui";

export function ContactForm() {
  const [state, action, pending] = useActionState(contactSubmit, null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form action={action}>
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Send a message</h2>
        <p className="mt-1 text-sm text-bark-500">Anne reads every message and replies as soon as she can.</p>
        <div className="mt-4 grid gap-4">
          <Field label="Your name" name="name" required autoComplete="name" value={name} onChange={setName} />
          <Field label="Email" name="email" type="email" required autoComplete="email" value={email} onChange={setEmail} />
          <Field label="Mobile (optional)" name="phone" type="tel" autoComplete="tel" value={phone} onChange={setPhone} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="f-message" className="text-sm font-semibold text-forest-900">
              Message <span className="text-clay-700" aria-hidden="true">*</span>
            </label>
            <textarea
              id="f-message"
              name="message"
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="rounded-xl border border-oat-300 bg-white px-4 py-3 text-base focus:border-forest-700"
            />
          </div>
          {/* honeypot - hidden from humans and screen readers */}
          <div className="hidden" aria-hidden="true">
            <label htmlFor="f-website">Website</label>
            <input id="f-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          {state && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
          <button type="submit" disabled={pending} className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900 disabled:opacity-50">
            {pending ? "Sending…" : "Send message"}
          </button>
          <p className="text-xs text-bark-500">
            Your message is only used to reply to you. See our privacy notice for how data is handled.
          </p>
        </div>
      </Card>
    </form>
  );
}
