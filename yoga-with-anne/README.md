# Yoga with Anne - website & booking platform

A complete website and booking system for **Yoga with Anne**, a gentle yoga & meditation class in Lucan, Co. Dublin. Students can see the live schedule, book drop-ins, blocks and bundles, book workshops and retreats (including places for friends), join a waitlist, and manage everything from their email. Class passes and multi-date drop-in discounts are optional per-installation features, off by default. The teacher runs day-to-day offerings and bookings; a Super Admin manages the site setup.

## Fastest safe local start

```bash
npm install
npm run setup     # creates + migrates the SQLite database and seeds demo content
npm run dev       # http://localhost:3000
```

That's it - **no API keys or accounts are needed to run locally**. Payments route to a clearly-labelled test page and emails land in a dev preview log (`/admin/messages`) instead of being sent.

**Admin area:** http://localhost:3000/admin - sign in with the credentials printed by the seed step (defaults: `anne@yogawithanne.ie` / `change-me-immediately`; set `ADMIN_EMAIL` / `ADMIN_PASSWORD` before seeding to override, and change the password after first login).

## What's inside

| Area | Route | Highlights |
| --- | --- | --- |
| Homepage | `/` | Hero, live next classes, what to expect, pricing preview, venue, FAQs, newsletter |
| Schedule & booking | `/classes`, `/book` | Drop-in, blocks, bundles, capacity holds, guest checkout |
| Workshops & retreats | `/workshops`, `/book` | Date-span group events with attendee names and teacher-managed transfers/refunds after cancellation; retreat daily schedules support shared or per-date times |
| Prices | `/prices` | Drop-in, blocks, bundles; optional passes, multi-date discounts, memberships |
| Class detail | `/classes/[id]` | Suitability, what to bring, accessibility, venue, Event structured data |
| Custom pages | `/<slug>` | Super Admin pages with ordered prepared sections; drafts are private |
| Customer area | `/account` | Password-free magic-link sign-in: bookings, passes, receipts, consent |
| Admin | `/admin` | Dashboard, schedule & series, bookings, waitlist, customers, pricing, content, Pages & menus, photos, settings, launch readiness, audit log |
| Policies | `/policies/[slug]` | Draft-until-published legal pages with versioned acceptance |

## Commands

```bash
npm run dev            # develop at http://localhost:3000
npm run build && npm start   # production-style local run
npm run setup          # migrate + seed (idempotent; tops up future class dates)
npm run db:migrate     # apply schema only
npm run db:seed        # seed/top-up only
npm test               # unit + integration + browser E2E
npm run test:unit
npm run test:integration   # isolated temporary DB/build and dynamically allocated port
npm run test:e2e           # Playwright: real-browser journeys + axe accessibility scans
```

### Docker

```bash
cp .env.example .env   # fill in
docker compose up -d --build
# with automatic HTTPS (edit Caddyfile domain first):
docker compose --profile tls up -d
```

See `DEPLOYMENT.md` for VPS (non-Docker) hosting, backups and restore.

## Requirements

- Node.js 22.13+ (uses the built-in `node:sqlite` module; no native database install) - or Docker
- No external services required for development. Optional integrations (Stripe, Resend) activate automatically when their environment variables are present - see `.env.example`.
- **Per-teacher installation**: every business has its own database and settings. Super Admin configures the website; Teacher-owner runs offerings and bookings. Palettes, class passes, multi-date discounts, and memberships are configured per installation; passes and multi-date discounts default off.
- **Blocks & bundles**: sell a term of classes in one click - a named block of weekly dates for one price (re-advertisable later at a shorter length/price without touching earlier bookings), and multi-save bundles combining blocks. Advertised above the drop-in schedule; non-refundable terms enforced at checkout.
- Phone numbers are **mandatory at booking** (emergency contactability) with a one-click "copy all phone numbers" register button.
- Simulated test payments and all dev conveniences **fail closed in production** (`src/lib/runtime.ts`) - a forgotten env var can never expose a fake payment path.
- Checkout also fails closed while required legal policies are unpublished, and late Stripe payments are always refunded or fulfilled - never silently lost (`ARCHITECTURE.md` → order lifecycle).

## Documentation

- [`OWNER_GUIDE.md`](./OWNER_GUIDE.md) - plain-English manual for running the business day to day
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) - stack, data model, and key decisions
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) - production setup (database, Stripe, email, domain, backups)
- [`QA_REPORT.md`](./QA_REPORT.md) - what was actually tested and the results
- [`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md) - everything to do before go-live
- [`ASSUMPTIONS_AND_CHANGES.md`](./ASSUMPTIONS_AND_CHANGES.md) - decisions taken and departures from the original brief
- [`PRICING_RESEARCH.md`](./PRICING_RESEARCH.md) - Sept 2026 Dublin market comparison behind the default prices
- [`FINAL_SPRINT_REPORT.md`](./FINAL_SPRINT_REPORT.md) - audit findings and changes from the completion sprint
- [`FINAL_FIX_REPORT.md`](./FINAL_FIX_REPORT.md) - final adversarial correctness pass: every verified defect, root cause, fix and regression test
