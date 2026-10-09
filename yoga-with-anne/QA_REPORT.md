# QA Report

**Last updated:** 28 September 2026 (final correctness pass) · **Build:** Next.js 15.5 production build · Node 23.9 / macOS 14.8 (arm64)

> Sections below marked **[Historical]** describe earlier passes and are superseded by the current results at the top. They are retained as an honest record.

## Current results (after the final adversarial fix pass)

| Suite | Command | Result |
| --- | --- | --- |
| Unit | `npm run test:unit` | **48/48 pass** - pricing engine (21), timezone/DST (13, incl. DST-safe duplication), money, Stripe signatures, upload validation, open-redirect guard, canonical-facts source scan |
| Integration | `npm run test:integration` | **44/44 pass** - boots the production build on :3100 against a fresh DB; HTTP authorisation/headers/health/OG + full business-flow coverage incl. subscription lifecycle, late-payment recovery, cancellation settlement, refund ledger, coupon concurrency |
| E2E | `npm run test:e2e` | **17/17 pass** - Playwright Chromium: full guest booking journey, mobile nav (390px), admin journeys, media upload/validate/delete, owner price/phone propagation, series €→cents, launch-readiness count invariant, nested-form check, 404, axe accessibility scans (0 critical/serious) |

Highlights of what the final pass added coverage for (full defect list in FINAL_FIX_REPORT.md):

- **Money safety:** canonical drop-in price (admin edit → public display → quote → stored order all agree); series override stored in cents; refunds cannot exceed a payment (`refunded_part`/`refunded`); duplicate/late payments flag `refund_required` and never end paid-but-silent.
- **Stripe membership lifecycle:** subscription id persisted atomically at activation; renewal / payment-failure / deletion handlers verified; duplicate events idempotent.
- **Fail-closed policies:** draft required terms block ALL checkout paths; acceptance (slug+version) recorded on payment.
- **Cancellation settlement:** organiser class cancellation returns pass credits exactly once, flags online refunds, invalidates waitlists, sends exactly one email per attendee, replay-safe.
- **Owner data:** phone/venue/schedule edits propagate everywhere; a source-scan test forbids hard-coded business facts outside the seed/defaults.
- **Truthful seed:** no unverified venue claims on a fresh database; parking/access await owner confirmation (Launch Readiness prompts privately).

## Current browser QA

- Automated Playwright (Chromium): booking journey, mobile 390px nav, admin journeys incl. photo upload and price/phone edits, launch-readiness invariant, hydration-safe interactions, axe scans.
- Manual (ZCode in-app browser, final code): production-mode smoke (home 200, `/api/health` ok, OG image 200, CSP+HSTS headers present, simulated payment refused in production), desktop 1440 and mobile 390 passes, no console/hydration errors.
- Screenshots: `screenshots/` (home desktop/mobile, prices, class detail, booking confirmed, test payment, admin dashboard/schedule/email preview/launch readiness).

## [Historical] First build pass (27 September, earlier)

Superseded numbers: 35 unit tests, first integration run (16 passed / 4 failed → fixed to 20/20), manual browser pass found 6 defects (venue label, pay-page crash, confirmation crash, email subject variables, phantom holds, €-sign) - all fixed and re-tested; those suites were later expanded into the current ones above.

## [Historical] Completion sprint (27 September, later)

Added Playwright/axe; found and fixed clay/gold contrast (<4.5:1), About `<h1>`, CSP/hydration interaction (CSP is production-only; dev Indicators disabled); seed and DB data-fixes for unverified claims; pricing simulator input id. Superseded counts: 40 unit / 20 integration / 10 E2E.

## Known limitations (current)

- Rate limiting is in-process (single-instance deployment by design).
- Membership pause handled via Stripe Billing Portal rather than custom UI.
- Stripe webhook lifecycle covered by extracted handlers with fixture semantics - not live Stripe traffic.
- Newsletter delivery is consent-recorded export only (no bulk sender, by design).
- Deep admin accessibility is manually verified; axe covers public pages + admin login.
