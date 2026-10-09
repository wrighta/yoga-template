"use client";

import { useActionState, useState } from "react";
import { submitEnquiry } from "../actions";
import { Alert, Field } from "@/components/ui";
import { Card } from "@/components/ui";

export function EnquireForm() {
  const [state, action, pending] = useActionState(submitEnquiry, null);
  const [topic, setTopic] = useState("Private one-to-one lesson");

  return (
    <form action={action}>
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Tell me what you have in mind</h2>
        <p className="mt-1 text-sm text-bark-500">I reply to every enquiry personally, usually within a day.</p>
        <div className="mt-4 grid gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
            What are you interested in?
            <select
              name="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="rounded-xl border border-oat-300 bg-white px-4 py-3 text-base"
            >
              <option>Private one-to-one lesson</option>
              <option>Small private group (friends, hen party…)</option>
              <option>Workplace or team class</option>
              <option>A custom retreat</option>
              <option>Something else</option>
            </select>
          </label>
          <Field label="Your name" name="name" required autoComplete="name" />
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <Field label="Mobile number" name="phone" type="tel" required autoComplete="tel" hint="The quickest way to reach you if I have questions." />
          {topic === "A custom retreat" || topic === "Small private group (friends, hen party…)" || topic === "Workplace or team class" ? (
            <Field label="Approximate group size" name="groupSize" type="number" min="1" placeholder="e.g. 6" />
          ) : null}
          <Field label="Preferred dates (optional)" name="preferredDates" placeholder="e.g. a Saturday in November, weekday mornings…" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="f-enquiry-message" className="text-sm font-semibold text-forest-900">
              Anything else I should know? <span className="text-clay-700" aria-hidden="true">*</span>
            </label>
            <textarea
              id="f-enquiry-message"
              name="message"
              required
              rows={5}
              placeholder="Your experience level, goals, location - whatever feels relevant."
              className="rounded-xl border border-oat-300 bg-white px-4 py-3 text-base focus:border-forest-700"
            />
          </div>
          {/* honeypot */}
          <div className="hidden" aria-hidden="true">
            <label htmlFor="f-enquiry-website">Website</label>
            <input id="f-enquiry-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          {state && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
          <button type="submit" disabled={pending} className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-900 disabled:opacity-50">
            {pending ? "Sending…" : "Send enquiry"}
          </button>
          <p className="text-xs text-bark-500">
            Your details are only used to reply to your enquiry. See the privacy notice for how data is handled.
          </p>
        </div>
      </Card>
    </form>
  );
}
