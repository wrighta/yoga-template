# Assumptions & changes

Every material decision taken while building, and why. The brief granted broad authority to improve the specification; business intent and the non-negotiables (server-side capacity, idempotent payments, guest checkout, owner self-management, GDPR posture, no invented content) were preserved in full.

## Stack decisions

1. **SQLite (built into Node) instead of PostgreSQL/Supabase.** A single-teacher, single-venue site with two weekly classes does not need a database server. SQLite in WAL mode with `BEGIN IMMEDIATE` transactions gives full ACID capacity enforcement with zero operational cost and one-file backups. The brief's Postgres preference is documented as the growth path: all SQL lives behind one module (`src/db/index.ts`) and DEPLOYMENT.md describes the Vercel+Postgres port. Row-level security was replaced by server-side authorisation on every admin/customer route and action (RLS is a Supabase-specific mechanism; the threat model is covered).
2. **Stripe via REST fetch instead of the official SDK.** Fewer locked dependencies; webhook signature verification and idempotency are explicit, visible and unit-tested. All Stripe code is isolated in `src/lib/stripe.ts` if the SDK is ever preferred.
3. **Resend over Postmark.** Both were named; Resend has a simple REST API and generous free tier. Isolated in `src/lib/mail.ts`.
4. **Integration tests via a Node runner + interactive browser QA instead of Playwright.** The environment made browser-binary installation and scripted browser automation costly; the same ten E2E scenarios from the brief are covered by (a) an integration suite that boots the real production server and drives HTTP + the domain layer, and (b) a recorded interactive browser pass across desktop and mobile (see `QA_REPORT.md`). Playwright can be added later; the scenarios map 1:1.
5. **Tailwind v4 CSS-first theme + two self-hosted variable fonts** (Fraunces, Inter via Fontsource) rather than a component library theme - keeps the design bespoke and avoids runtime font downloads.

## Product decisions

6. **Pricing engine applies the single best eligible structure and shows the alternatives.** "Best" is defined deterministically (entitlements → cheapest of multi-date / coupon / intro pass / pass purchase / drop-in, fixed tie-break) and pinned by 21 unit tests. No stacking, totals never negative, cents distributed across lines without loss.
7. **Pass purchases can be auto-applied** when cheaper than the seats they cover (e.g. 5 classes for €50 vs €60 drop-in). The customer is told exactly what was applied; unused credits remain on the pass. This implements "best eligible option transparently".
8. **Pass-credit redemption requires magic-link sign-in.** Guests always get the automatic multi-date rate; applying an owned credit needs identity, and requiring sign-in avoids leaking "this email has a pass" to unauthenticated probing.
9. **Memberships bought in test/offline mode activate immediately at confirmation** with a computed period end; with live Stripe, subscription lifecycle (renewal, payment failure) is driven by webhook events (`invoice.paid`, `invoice.payment_failed`). Owner-side cancellation lives in the Stripe dashboard; customer-side is cancel-at-period-end.
10. **Waitlist offers are claimed through the normal checkout** (pre-filled, held seat) rather than auto-charging - the brief forbids taking payment while waitlisted and forbids surprise charges.
11. **Reminders and housekeeping run through one cron endpoint + an admin button.** All three jobs (hold release, waitlist expiry, reminders) are idempotent, so cadence is unimportant and missed runs self-heal.
12. **Media uploads store files in the database** and are served via an API route - consistent with the single-file deployment story. Client-side downscaling keeps sizes sane.
13. **Seeded classes are future-dated and marked as samples** in their admin notes; re-seeding only tops up future dates and never touches real data. The old June–August 2026 dates from the brief were not seeded.
14. **No analytics** shipped (the brief's "no dishonest cookie banner" is satisfied honestly: only essential cookies exist, and the Cookie Notice says exactly that).

## Content & compliance

15. **No invented biography, qualifications or testimonials.** The About page ships with honest, neutral copy; the qualifications section is empty (and hidden) until Anne adds real ones; the testimonials section only renders when a published, consent-noted testimonial exists. Admin labels make the required inputs explicit.
16. **Legal pages are draft-locked.** All four policy templates are marked "needs review", hidden from the public, and only appear when explicitly published. The Booking Terms (the one customers accept) records policy version at checkout.
17. **Health/medical stance:** no medical claims anywhere; the class page includes the brief's requested "seek professional guidance" note; no health questionnaire is collected at booking.
18. **Tax:** nothing asserted about VAT; a settings field (`tax_note`) publishes whatever the accountant decides, plus a launch checklist item.

## Smaller interpretations

- "Booking closed" defaults to 1 hour before class (series-level, configurable); booking opens immediately.
- Class capacity defaults to 12 for a community hall - configurable everywhere.
- Currency is EUR everywhere, stored as integer cents; `en-IE` formatting ("€12.00", "Tue 6 Oct", "7.30–8.30 pm").
- The customer account area shows upcoming/past bookings, pass balances with expiry, membership state, receipts and consent preferences; a Stripe customer-portal link is deferred until live Stripe exists (documented in the checklist).
- CSV exports (bookings per class, newsletter list, customers) and a printable class register cover the register/export requirements; the register deliberately omits email addresses to respect least-access.
- The WhatsApp channel is click-to-chat only (per the brief); no unofficial automation.


## Completion sprint (27 September 2026, post-handover)

18. **Simulated payments fail closed.** The audit found the test-payment page activated whenever `DEV_PAYMENTS != "0"` - including in a production deployment that simply forgot the variable. Now: production builds (`NODE_ENV=production`) refuse it unconditionally; dev servers honour `DEV_PAYMENTS=0` to disable. Verified by the launch-readiness page and the fail-closed integration test.
19. **Full media management** (the brief's largest gap): admin photo library with browser-side downscaling, magic-byte type sniffing, alt text, reference-safe deletion, and a picker wired to hero/portrait/logo/social/class-type images. Storage is DB-backed with a documented swap path.
20. **Owner back office completed**: venues, class types and instructors are now fully editable in admin (previously seed-only); series gained blackout dates, "fill the calendar forward", retire and duplicate; single classes can be duplicated (+1 week).
21. **Launch readiness dashboard** replaces part of the static checklist with live green/amber/red checks that link to the fixing screen.
22. **Stripe Billing Portal** for membership self-management, failing closed with friendly messaging when unconfigured.
23. **Email hardening**: duplicate-send guard (same template/recipient/record within 60s → suppressed), admin test-send, explicit preview/connected status.
24. **Security**: production-only CSP + HSTS, timing-safe cron token comparison, safe-redirect guard on all `next` params (unit-tested), server-side magic-byte upload validation, admin-only consistent-snapshot backup download (`VACUUM INTO`), custom error/404 pages without stack traces.
25. **Accessibility**: automated axe scans added to the E2E suite; found and fixed real defects (clay/gold contrast below AA on eyebrows/badges/banners, low-contrast placeholder/meta text, missing `<h1>` on About).
26. **SEO**: dynamic branded Open Graph images (`/api/og`), uploaded social-image override, favicon mark, LocalBusiness + Breadcrumb structured data, organizer on Events.
27. **Deployment**: Dockerfile + docker-compose (volume, healthcheck, enforced `DEV_PAYMENTS=0`), Caddy TLS option, backup/restore scripts, `/api/health`.
28. **Pricing research** (`PRICING_RESEARCH.md`): Sept 2026 Dublin comparison (YogaHub first-party; Yelp/Facebook as context) concluded the seeded prices are correctly positioned; no changes.
