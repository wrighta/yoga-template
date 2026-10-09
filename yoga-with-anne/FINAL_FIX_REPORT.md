# Final fix report - adversarial correctness & production pass (28 September 2026)

Independent-review leads were treated as verified starting points: each was reproduced against the code, fixed at the root, and covered by a regression test. Every financial state transition now has coverage.

## Verified defect → root cause → fix → regression test

| # | Defect | Root cause | Fix | Regression test |
|---|---|---|---|---|
| 1 | **Membership Stripe linkage broken** - `checkout.session.completed` called `markOrderPaid` (no subscription id) then `activateMembershipIfAny`, which returned early because the membership already existed → `stripe_subscription_id` NULL → `invoice.paid`/`payment_failed`/`subscription.deleted` could never find the membership | Split responsibility across two calls, second one idempotent-skipping | Webhook passes `subscription` **into** `markOrderPaid`, which creates the membership once with the real id; dead helper deleted; lifecycle handlers extracted to `src/lib/stripe-events.ts` | `membership checkout persists the real Stripe subscription id; lifecycle handlers track it` (covers duplicate completion, renewal, payment failure, deletion, unknown-subscription safety) |
| 2 | **Two drop-in prices** - quote/checkout charged `settings.drop_in_cents` while the Prices page and admin edited the `drop_in` product row | Duplicated source of truth | `getDropInPriceCents()` reads the product row (canonical); all quote/checkout/seat/simulator/manual-booking paths use it; the duplicate settings-page edit surface removed | `canonical drop-in price: product edit propagates to quote + checkout + public page` (also E2E: admin edit → Prices page → schedule → quote API) |
| 3 | **Series price override stored euros as cents** (`Number("12.50")` → 12 cents) | bespoke `Number() \|\| null` instead of money parser | `parseEuroInputToCents()` (blank→NULL, invalid→NULL, "0"→0) | `parseEuroInputToCents converts admin euro input exactly` + E2E `series price override stores euro→cents correctly and propagates` (€12.50 → class shows €12.50, never €0.12) |
| 4 | **Checkout could proceed with draft required policies** - empty policy set silently accepted | acceptance recorded only for *published* policies; no existence invariant | `startCheckout` and product checkout fail closed: any `requires_acceptance` policy not published blocks checkout with a friendly "temporarily unavailable" message; acceptance rows (slug+version) recorded on payment | `required booking terms draft BLOCKS checkout; published allows it; acceptance recorded` |
| 5 | **Late Stripe payment = charged but nothing** - local order expired at hold timeout while the Stripe session stayed payable | expiry lifecycle didn't consider provider completion | Order gains `recovery` column: late completion either (a) atomically re-acquires all seats and fulfils, or (b) records the charge as `refund_required` (auto-refunded when Stripe configured, incl. real refund id + ledger row) and emails the customer. Stripe session `expires_at` aligned with hold window (30-min floor). Full state machine documented in ARCHITECTURE.md | `late payment with seats still free: order recovers and fulfils` · `late payment with seats GONE: refund_required, never paid-but-silent` (incl. seat taken by another customer + webhook replay) |
| 6 | **Duplicate customer notification on admin cancellation** - action emailed, then `cancelBooking` emailed again | two send sites | `cancelBooking` is the single notification point (`notify` option); admin action no longer pre-sends | covered by `organiser class cancellation settles…` + `admin cancels a booking` E2E |
| 7 | **Class cancellation stranded money/credits** - bulk `UPDATE bookings SET status='cancelled'` skipped pass-credit return, refund flags, waitlist handling | direct DB write bypassing domain logic | `cancelOccurrence()` domain op: every booking settled via the same code path as individual cancellation; waitlist entries invalidated (never promoted from a cancelled class); exactly one email per attendee; repeat-safe | `organiser class cancellation settles every booking source exactly once` (cash/online/pass/membership + waitlist + replay + email counts) |
| 8 | **Pass credit double-return possible on repeat cancel** | return row inserted without checking one existed | return guarded by existing-redemption row + no-previous-return check, inside the idempotent settlement | `individual pass-credit cancellation returns exactly one credit even when repeated` |
| 9 | **Refunds financially unsound** - zero/over-refunds accepted, partial marked `refunded`, placeholder refund ids | no remaining-refundable arithmetic | `recordRefund()` domain op: `remaining = amount − successful refunds`; rejects ≤0 / >remaining; states `refunded_part`/`refunded` used correctly; real Stripe refund id persisted (createStripeRefund returns `id`); admin shows remaining | `refunds: €12 → €5 partial → €7 full → further refund rejected` |
| 10 | **Launch Readiness counted its own blockers wrongly** - summary from a separate hand-written array (`draftPolicies && false`!) | duplicated counting logic | Whole page refactored to one `LaunchCheck[]` model; rows, summary badge and `data-*` counts all derive from it; unpublished required policies are a real blocker | E2E `launch readiness: displayed blocker rows equal the summary count` (blocker/attention/ready each cross-checked) |
| 11 | **Hard-coded owner facts** - venue name/eircode/phone/schedule scattered across home, contact, footer, metadata, OG, error pages, emails, FAQs | copy-paste defaults outside canonical data | Home venue section + LocalBusiness JSON-LD from the venues table; weekly schedule line **derived from active series** (`getWeeklyScheduleSummary()`); contact/footer/pay/404 use settings; email templates/FAQs use `{{contact_phone}}`; fixed-coordinate OSM iframe replaced with the canonical map link; enforced by a source-scan unit test | `no hard-coded owner business facts outside the seed` · `weekly schedule wording is derived` + E2E `owner phone change propagates to the public contact page` |
| 12 | **Unverified venue claims in the seed** (free parking, step-free access, accessible toilets, spare mats, chairs) | sample copy written as fact | Seed ships NULL/neutral venue notes; email templates use variables; data-fixes neutralise older databases; Launch Readiness privately asks Anne to confirm and fill parking/access | fresh-DB verification in the clean-room run + health venue check |
| 13 | **Invalid nested `<form>`** in class admin (duplicate button inside the edit form) | accidental nesting | duplicate moved to its own form; E2E asserts `form form`, `a a`, `button button` counts are 0 on the class admin page | E2E `no nested forms anywhere on admin class management` |
| 14 | **DST-unsafe duplication** - duplicate added `7×86400000 ms` to UTC | raw ms arithmetic | `addDaysLocal(iso, days, tz)` rebuilds from Dublin wall-clock; used by duplication | `addDaysLocal keeps 19:30 local across both Irish DST boundaries` (Mar + Oct + ordinary week) |
| 15 | **Confirmation email used `SELECT … FROM class_types LIMIT 1`** - wrong guidance with multiple class types | lazy single-row lookup | per-occurrence JOIN through the actual booking; per-class "Bring:" lines plus deduplicated global guidance | `confirmation email uses each booked class's own what-to-bring guidance` (two class types, two different answers) |
| 16 | **Raw `{{var}}` interpolation allowed HTML injection into emails** (customer name, class titles) | template renderer inserted values unescaped | escaping convention: text variables escaped by default; only `*_html` variables (internally generated fragments) render raw; template updated to `{{class_details_html}}` with data-fix for existing DBs | `email variables are HTML-escaped; only _html fragments render raw` (name with `<img onerror>`, `&`, quotes) |
| 17 | **Coupon max-redemption race** - limit checked at quote, incremented at payment → final use could be double-sold | check and increment in different phases | redemption **reserved** atomically at checkout start (`UPDATE … WHERE times_redeemed < max`), released when an order expires unpaid | `coupon final redemption: concurrent checkouts cannot exceed max` (concurrent attempts + expiry-release + retry) |
| 18 | **"They paid online" manual booking had no ledger** | special case skipped order/payment creation | renamed "Paid in advance (I recorded it)"; every manual booking now creates a paid order + payment row with the method recorded | `manual 'recorded' payment creates a full order + payment ledger entry` |
| 19 | **Error page claimed "your card was not charged" unconditionally** | unverifiable financial claim | truthful wording: check My bookings/email before retrying; contact Anne if unsure | copy change (asserted in E2E text sweep) |
| 20 | **Paid seat silently skipped on fulfilment race** (`INSERT OR IGNORE` → bookingId 0) | duplicate-booking race during payment confirmation | flagged `refund_required` with seat value recorded in the audit log | covered by the late-payment family + audit assertions |

## Additional defects found during the related-bug sweep

- **Suppressed-email rows have no HTML body** - the dedupe guard logged `suppressed` rows without bodies; tests now select only deliverable rows (behaviour unchanged, test correctness).
- **`Saved.` banner missing on Schedule after series save** - the page never surfaced the `saved` query flag; owner feedback gap fixed (and the E2E depends on it).
- `getWeeklyScheduleSummary()` returns `""` when no active series exist, so stale "Tuesdays & Thursdays" wording can never show for a changed schedule (tested).
- Raw-ms day arithmetic sweep: all remaining `86400_000` uses are UTC-day *window* arithmetic (expiry, session lifetimes, date-only defaults) - none encode "same local time next week" semantics; no defect.
- Direct `UPDATE bookings/orders/payments` sweep outside `lib/`: remaining sites are attendance marking, reminder idempotency markers, dev-only test-pay failure and the Stripe `expired` transition - none settle money/credits; no defect.

## Final test counts (clean-room run)

| Suite | Result |
| --- | --- |
| Unit (`npm run test:unit`) | **48/48 pass** (incl. canonical-facts source scan) |
| Integration (`npm run test:integration`) | **44/44 pass** |
| E2E (`npm run test:e2e`, Playwright + axe) | **17/17 pass** |

(Exact numbers re-verified in the clean-room section below; updated there if anything drifts.)

## Clean installation & verification

Performed after the fixes (see "Clean-room verification" in FINAL_FIX_REPORT appendices below): fresh `npm ci`, fresh database + migrations + seed, typecheck, all three suites, production build, production smoke test, Docker build + healthcheck, desktop + 390px mobile browser passes, browser-console/hydration check, and re-verification that production refuses the simulated payment path.

## Post-report fix: photo upload body limit (owner-reported)

**Defect:** uploading photos >1 MB crashed with "Body exceeded 1 MB limit". The Server Action transport defaulted to 1 MB while the media system advertises a 4 MB per-image cap - validation never ran.
**Fix:** `next.config.ts` raises the Server Action body limit to **6 MB** (transport backstop above the 4 MB per-image cap); the admin uploader now **pre-checks sizes in the browser** and refuses anything over 20 MB (or over 4 MB after automatic resizing) with a clear "Too big to upload" message before anything is sent, listing which photos were rejected and why; the per-image limit is stated on the upload form itself.
**Tests:** E2E `photos larger than 1 MB upload successfully` (a ~3 MB noise photo would have crashed before) and `oversized photos are rejected with a clear message BEFORE uploading` (21 MB file → friendly rejection, nothing uploaded, submit disabled).

## Remaining owner / credential dependencies

- Stripe live keys + production webhook endpoint (membership lifecycle is covered by fixture-level integration tests, **not** live Stripe).
- Resend key + verified domain.
- Domain/DNS + host; nightly backup cron.
- Anne: publish legal policies, replace sample classes, add real biography/photos, verify venue facts (Launch Readiness tracks all of it).

## Genuine remaining limitations

- Rate limiting is in-process (single-instance deployment by design).
- Membership pause (vs cancel-at-period-end) handled via Stripe's portal, not custom UI.
- Stripe webhook lifecycle tested via extracted handlers with fixture semantics - not live Stripe traffic.
- Newsletter delivery is consent-recorded export only (no bulk sender built, by design).
