# Architecture

## Stack and why

| Layer | Choice | Reasoning |
| --- | --- | --- |
| Framework | **Next.js 15 (App Router) + React 19 + TypeScript** | Server components/actions keep the interactive cart light while all money and booking logic stays server-side. |
| Styling | **Tailwind CSS v4** with a custom token theme | A bespoke design system (oat/sage/forest/clay palette, Fraunces + Inter) rather than an off-the-shelf component theme. |
| Database | **SQLite** via Node's built-in `node:sqlite`, WAL mode | Zero-dependency, transactional, and genuinely sufficient for a single-teacher, single-venue business. Full schema in `src/db/schema.sql`; access through a thin helper (`src/db/index.ts`) with `BEGIN IMMEDIATE` write transactions + busy retries. Money is integer cents; timestamps are UTC ISO strings; Europe/Dublin is a setting. See *Deviations* below for the Postgres path. |
| Validation | Zod available; hand-rolled parsing + server-side re-validation on every action | Every mutation re-validates input and re-computes pricing server-side; client state is never trusted. |
| Payments | **Stripe Checkout + Billing via REST** (`fetch`, no SDK) with signature-verified webhooks | Fewer dependencies to pin; webhook verification is hand-implemented and unit-tested (`tests/unit/stripe-sig.test.ts`). |
| Email | **Resend** REST API, falling back to a dev preview log | Templates live in the database and are editable in `/admin`. |
| Tests | `node:test` (unit) + custom integration runner booting the real server | Business-rule tests that actually exercise pricing, capacity, and idempotency. |

## Data model (src/db/schema.sql)

Core entities and their relationships:

```
settings ─ key/value JSON (business info, rules, toggles)
admins / admin_sessions          customers / customer_tokens
instructors ─┐
venues ──────┼─ class_series ──► class_occurrences ──► bookings ──► customers
class_types ─┘                         │                    │
                                       capacity_holds       order_items ◄─ orders ──► payments ──► refunds
waitlist_entries (per occurrence, queued with offers+expiry tokens)
products (drop_in | pass | membership) · discount_rules (multi-date) · coupons
passes ── pass_credit_ledger (immutable ledger: purchase / redeemed / returned / admin_adjustment)
memberships (period start/end, cancel_at_period_end, stripe_subscription_id)
content_blocks · faqs · testimonials · media · email_templates / email_log
policies / policy_acceptances · contact_messages · audit_log · stripe_events (webhook idempotency)
```

Key constraints:

- `bookings` has a **partial unique index** on `(occurrence_id, customer_id) WHERE status IN ('confirmed','attended')` - a customer can never double-book a class at the database level.
- `capacity_holds` + the confirmed-booking count are re-checked **inside a `BEGIN IMMEDIATE` transaction** when a checkout starts, so the last seat cannot be oversold (tested with 6 concurrent attempts).
- `stripe_events` stores every processed webhook event id; replays short-circuit.
- `pass_credit_ledger` is append-only; a pass balance is derived, never mutated.
- Orders keep a full `pricing_snapshot` JSON - the exact price structure the customer agreed to, immune to later price edits.

## Key invariants (adversarially tested)

- **One canonical drop-in price**: the active `drop_in` product row (Admin → Pricing). Every display, quote, checkout and manual-booking path derives from it via `getDropInPriceCents()`. Admin money inputs parse euro strings into cents (`parseEuroInputToCents`).
- **Optional pricing features are per installation**: class passes and the multi-date drop-in discount are disabled unless their Super Admin settings are enabled. Existing pass-credit entitlements remain redeemable when new pass sales are disabled.
- **Homepage composition is per installation**: the Super Admin can change visibility and visual order for the existing prepared sections; missing or malformed layout settings fall back to the shipped defaults.
- **Previews do not publish settings**: draft pages and candidate homepage palettes render only for a Super Admin session, are marked noindex, and do not mutate public navigation or saved appearance settings.
- **Retreat times are descriptive metadata**: `class_blocks.daily_times_json` stores shared daily hours or per-date hours. Inventory, capacity, and booking remain a single date-span event slot.
- **Required policies fail closed**: any `requires_acceptance` policy that is not published blocks every checkout path; accepted slug+version rows are recorded on payment.
- **Order lifecycle (incl. late payments)**:
  `pending/awaiting_payment --(paid event)--> paid --fulfil--> bookings/pass ledger/membership`
  with two safety nets: an expired order whose Stripe session later completes either **re-acquires all seats atomically and fulfils**, or records the charge as `orders.recovery='refund_required'` (auto-refunded via Stripe with the real refund id when configured) and emails the customer - a paid-but-silent state is impossible. Coupons are **reserved** at checkout and released on expiry, so the final permitted redemption cannot be double-sold. Stripe session `expires_at` is aligned to the hold window (30-min floor).
- **Cancellation settlement**: one shared `settleBookingCancellation()` powers individual and whole-class cancellation - pass credits return exactly once (guarded), online orders flag `refund_required`, waitlists on a cancelled class are invalidated (never promoted), one email per attendee, replay-safe.
- **Refund ledger**: `remaining = amount − Σ successful refunds`; rejects invalid/over-refunds; persists the real Stripe refund id; `refunded_part` vs `refunded` reflect financial reality.
- **Event transfers**: a canceled Workshop/Retreat group booking can move atomically to a future published same-kind event after capacity validation. Attendee names are editable; higher prices use a separately recorded offline payment, while lower prices remain in `event_transfers` until a refund is recorded against the original payment. Stored cards are never charged for a transfer.
- **Email escaping**: template variables are HTML-escaped text by default; only `*_html`-suffixed variables (internally generated fragments) render raw.
- **Canonical owner data**: venue/schedule/phone facts render from the database (venues table, active series, settings). A unit test scans the source tree to keep business facts out of application code.

## Request/state flows

### Booking (guest)
1. `/classes` - server-rendered live schedule; the client-side cart (`localStorage`) holds selected occurrence ids.
2. `/book` - the client fetches `POST /api/quote`; the server recomputes the quote (entitlements only for signed-in customers) and returns the chosen structure plus alternatives.
3. Submit → `startCheckoutAction` → `startCheckout()`: duplicate-booking guard → `BEGIN IMMEDIATE` capacity re-check → holds (10 min, configurable) → order `awaiting_payment` with pricing snapshot.
4. Payment: Stripe Checkout (when `STRIPE_SECRET_KEY` set) or the dev-only test-pay page (`DEV_PAYMENTS=1`).
5. `markOrderPaid()` (idempotent, single transaction): order → `paid`, holds consumed, bookings created, pass rows + ledger entries written, membership activated, coupon redeemed, payment row inserted. Then confirmation email (previewed or sent).
6. Confirmation page: details, `.ics` links, cancellation entry point; polls `/api/order-status` while a Stripe webhook is in flight.

### Pricing engine (`src/lib/pricing.ts`, pure & unit-tested)
Applied in deterministic order, always returning the single best option for the customer (no stacking):
1. **Entitlements** - pass credits (earliest-expiring first), then membership coverage (period + class-type rules).
2. **Paid seats** - candidates: drop-in sum, optionally enabled multi-date rule, coupon (off drop-in baseline), and pass purchase options only when passes are enabled. Cheapest eligible option wins; totals can never go negative; cents split across lines without loss.
3. Returns the chosen structure, per-seat prices, and transparent alternatives used by the UI/simulator.

### Communications
All templates live in `email_templates` (editable in admin) and are rendered with shared variables (`business_name`, contact details, …). Every send is recorded in `email_log` - `sent` (Resend), or `preview` in development. Scheduled work (reminders, waitlist offer expiry, hold release) runs via `GET /api/cron/reminders?token=…` (idempotent per booking via `reminder_sent_at`) and the admin's "Run reminders & jobs now" button.

### Auth
- **Admin:** scrypt-hashed passwords, DB-backed session tokens in an `HttpOnly`/`SameSite=Lax` cookie, explicit Super Admin/Teacher-owner permissions enforced server-side; legacy role aliases remain during migration; login is rate-limited; important actions land in `audit_log`.
- **Customers:** no passwords. Magic-link tokens (hashed at rest, 15-min expiry, single use) create a 30-day session cookie. Request responses are identical whether or not the email exists (no account enumeration).
- Webhook: raw-body HMAC verification with timestamp tolerance.

## Design decisions & deliberate deviations from the brief

1. **SQLite instead of Postgres/Supabase.** For one venue with two weekly classes, SQLite in WAL mode is transactional, fast, operationally free, and trivially backed up (one file). The brief's Postgres preference is honoured by a clean seam: all access goes through `src/db/index.ts` + standard SQL, so a Supabase/Postgres port means swapping that module and adjusting a handful of SQL types - documented in `DEPLOYMENT.md`. Row-level security isn't applicable; instead every admin/customer route and action authorises server-side.
2. **Stripe via REST, not SDK.** Fewer pinned dependencies; signature verification and idempotency are explicit and tested. Swapping in the SDK later is contained to `src/lib/stripe.ts`.
3. **Optional pass purchase auto-application.** When class passes are enabled, a pass may be applied when cheaper than the seats it covers. Leftover credits remain on the pass for future use. Pass sales are hidden by default.
4. **Pass redemption requires signing in.** Applying an existing pass credit needs a magic-link sign-in so the system can identify ownership without leaking data to email probing. The multi-date discount is independently optional and off by default.
5. **Playwright replaced by (a) a Node integration suite that boots the real server and drives HTTP flows, and (b) an interactive browser QA pass** (see `QA_REPORT.md`). Same coverage targets, no browser binary dependency in CI. Adding Playwright later is straightforward - the flows in `tests/integration/` map 1:1 to E2E specs.
6. **Media uploads are admin-only and stored in the database** (served via `/api/media/[id]`), keeping the single-file deployment story intact. Photography placeholders are tasteful SVG art until Anne uploads real photos.
7. **Tax.** Nothing is asserted about VAT; a `tax_note` setting surfaces whatever the owner's accountant decides on the prices page, plus a launch checklist item.

## Project layout

```
src/
  app/
    (site)/            public site + booking + account (shared chrome, dynamic)
    admin/             login + (protected)/ dashboard & management pages
    api/               quote, order-status, webhooks/stripe, cron/reminders,
                       ics, admin/export, admin/simulate
    sitemap.ts, robots.ts
  components/          design system + cart + class cards
  db/                  index.ts (driver+tx), schema.sql, migrate.ts, seed.ts
  lib/                 pricing, booking, schedule, customers, settings, content,
                       tz (DST-safe), money, mail, stripe, auth, ratelimit, markdown
tests/
  unit/                pricing, timezone/DST, money, stripe signatures (40 tests)
  integration/         runner boots the built app on :3100 against a fresh test DB (20 tests)
screenshots/           key screens captured during QA
```
