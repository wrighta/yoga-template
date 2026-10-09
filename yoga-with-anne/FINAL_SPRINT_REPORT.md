# Final sprint report - completion pass (27 September 2026)

Independent audit → fix → test → browser-verify, taking the existing working platform from "very good prototype" to launch-ready. Nothing was rebuilt; every working behaviour was preserved.

## 1. What was audited

Public pages, mobile/desktop UX, booking flow, pricing, passes, memberships, waitlist, customer auth, cancellations, all admin areas, database, emails, payment integration, cron, security, accessibility, SEO, media handling, deployment, tests - by reading the implementation (not the handover docs) and grepping for the specific risk patterns, then running the existing suites as a baseline (40 unit + 20 integration, all passing).

## 2. Problems discovered and FIXED

| # | Severity | Problem | Fix |
|---|---|---|---|
| 1 | **P0** | Simulated test payments activated whenever `DEV_PAYMENTS != "0"` - **including in production** with a forgotten env var | Fail-closed rule in `src/lib/runtime.ts`: production builds refuse the simulator unconditionally; dev honours `DEV_PAYMENTS=0`. Integration test pins it; docker-compose forces `DEV_PAYMENTS=0`. |
| 2 | **P1** | No real media workflow (site copy *implied* Anne could swap photos; she couldn't) | Complete photo system (below). |
| 3 | **P1** | Venues, class types, instructors were seed-only - not owner-editable | Full admin CRUD with owner-friendly labels. |
| 4 | **P1** | Series management gaps: no holidays/break weeks, no top-up, no retire/duplicate | Blackout dates on create + per-series skip list, "Fill the calendar forward", retire, duplicate series, duplicate occurrence (+1 week). Series edits never touch existing occurrences (documented in UI). |
| 5 | **P1** | No custom 404/error pages (raw Next defaults; stack traces possible) | Friendly branded 404 + error page with digest reference, "your card was not charged" reassurance, recovery actions. |
| 6 | **P1** | Axe found real a11y defects: clay eyebrow text 3.2:1, gold-on-gold badges 4.3:1, low-contrast small text, **About page had no `<h1>`** | Token fixes (clay-700, new gold-800), bark-300 text bumped, About now has a proper h1. Axe scans now part of CI (zero critical/serious). |
| 7 | **P2** | Open-redirect surface on magic-link `next` param | `safeRedirectPath` guard (allows only same-site paths; unit-tested incl. `//host`, `/\host`, schemes). |
| 8 | **P2** | Cron token compared with `!==` (timing) | Constant-time comparison. |
| 9 | **P2** | No CSP/HSTS | Production-only CSP (frame-ancestors none, object-src none, Stripe form-action) + HSTS. Dev excluded (React Refresh needs eval). |
| 10 | **P2** | Media route served by numeric id (enumerable); backup endpoints absent | Media validation hardened (magic bytes, size, sanitised names); backup download owner-only via consistent `VACUUM INTO` snapshot, streamed and deleted. |
| 11 | **P2** | Email double-send possible on retry races; no way to verify delivery before launch | 60-second duplicate-send guard (logged as `suppressed`); admin "Send test email"; explicit preview/connected status banner. |
| 12 | **P2** | Membership self-management missing | Stripe Billing Portal endpoint + account-page button, failing closed with friendly copy; customer creation + `stripe_customer_id` reuse. |
| 13 | **P2** | GDPR self-service export missing | `/api/account/export` (signed-in customer downloads everything held about them, JSON). |
| 14 | **P2** | Content accuracy: unverified factual claims (tea after class, spare mats) | Softened in seed + live DB; "Verify venue facts" attention row added to the launch dashboard so Anne confirms parking/access/equipment. |
| 15 | **P3** | No OG/social images, no favicon, thin structured data | Dynamic branded OG images (`/api/og`, ImageResponse) with uploaded-image override, SVG favicon, LocalBusiness + Breadcrumb JSON-LD, Event organizer. |
| 16 | **P3** | Deployment was manual VPS only | Dockerfile (multi-stage, non-root, volume, HEALTHCHECK) + docker-compose (enforced `DEV_PAYMENTS=0`) + Caddy TLS profile + `scripts/backup.sh` / `restore.sh` + `/api/health`. |

## 3. New features (brief sections 3 & 9)

- **Media system** (`/admin` → Photos): multi-upload with automatic browser-side downscaling (≤1920px, JPEG 85%), magic-byte type sniffing (JPEG/PNG/WebP only, ≤4 MB), alt-text editing, reference-safe deletion (refuses while used by settings/class types), grid previews, and a reusable image picker wired to **logo, homepage hero, Anne's portrait, social-share image, class-type images** - each with graceful fallback to the existing illustration. Storage is DB-backed (BLOB via `/api/media/[id]`); the swap-to-object-storage path is documented in ARCHITECTURE.md.
- **Launch readiness dashboard**: live GREEN/AMBER/RED checks - site URL, default admin password (verified against the actual hash), Stripe keys, webhook secret, email provider, cron token, dev-payments status, draft policies, sample classes remaining, About placeholder, photo library, venue/contact completeness, last job run, backups, venue-fact verification - each linking to the screen that fixes it.

## 4. Test results (exact counts, all run to completion)

| Suite | Command | Result |
| --- | --- | --- |
| Unit | `npm run test:unit` | **46/46 pass** |
| Integration (real server, fresh DB) | `npm run test:integration` | **27/27 pass** |
| Browser E2E (Playwright + axe) | `npm run test:e2e` | **11/11 pass** |

New tests this sprint: image magic-byte/type/size validation, filename traversal sanitisation, open-redirect guard, constant-time secret comparison, health endpoint (no secret leakage), OG route, media 404s, backup owner-only, customer export/portal auth, portal fail-closed with a real customer session, security-header presence, media upload→alt→invalid-rejection→deletion through the real admin UI, pricing simulator €22.00 via UI, admin wrong-password rejection, mobile nav, friendly 404.

## 5. Browser QA performed

- **Automated Playwright (Chromium):** full guest booking journey (2 dates → €22.00 → test payment → confirmation), mobile navigation at 390px, admin journeys (login failure + success, dashboard, health, media upload/delete, venues, pricing simulator), accessibility scans on every public page + admin login.
- **Manual (ZCode in-app browser):** production-mode server smoke (home/health/admin), Launch readiness page reviewed visually (`screenshots/admin-launch-readiness.png`), prices + class detail re-captured (`prices-desktop.png`, `class-detail.png`).
- Defects found *by the new E2E suite* and fixed: the CSP-blocked dev hydration, the About `<h1>` gap, remaining gold contrast - each re-tested to green.

## 6. Security improvements summary

Fail-closed dev payments · production CSP + HSTS · timing-safe cron secret · safe-redirect guard · server-side upload validation (magic bytes) · owner-only consistent-snapshot backup endpoint · friendly error pages (no stack traces/digests only) · admin session cleanup on login · duplicate-send suppression · rate limits retained (in-memory, single-instance documented).

## 7. Performance

Production build sizes unchanged and small (shared first-load JS ≈ 103 kB; no new client libraries - axe/Playwright are dev-only). Fonts are self-hosted variable fonts; images lazy-load with explicit dimensions; OG images are cached. No benchmark anomalies introduced; correctness and live-schedule freshness prioritised over cache aggressiveness.

## 8. Production blockers (things only Anne/credentials can do)

1. Stripe live keys + webhook endpoint (site stays in preview mode until then - launch readiness marks this red).
2. Resend key + verified domain (otherwise customers receive no emails).
3. Legal review + publication of the four policy drafts.
4. Real schedule, photos, biography, testimonials.
5. Domain + DNS + host (Docker compose file is ready).
6. Nightly backup cron on the host + one restore rehearsal.

## 9. Known limitations

- Rate limiting is in-memory (correct for the single-instance deployment; documented).
- Membership pause (vs cancel-at-period-end) remains deferred to Stripe's portal.
- Favicon is a static SVG mark (dynamic per-site favicon unnecessary for one brand).
- Cross-instance SQLite scaling out of scope by design.
- `axe` scans cover public pages + admin login; deeper admin a11y verified manually only.

## 10. Recommended tasks for the final follow-up prompt

1. Connect Stripe test keys and do one guided end-to-end live check (booking → payment → webhook → refund).
2. Connect Resend and send one real email to a deliverable inbox (check spam placement).
3. Fill real content (schedule, bio, photos, policies) and watch the Launch readiness page go green.
4. Any visual polish preferences after seeing the site with real photography.

## 11. Clean state verification

- No secrets in the repo (`.env` gitignored; only `.env.example` with placeholders).
- Production cannot reach the simulated payment path (fail-closed + compose-enforced).
- Dev database reset to a clean seed; test bookings only ever exist in isolated `data/test.db` / `data/e2e.db` (both excluded from git).
- `npx tsc --noEmit` clean · `npm run build` clean · full suite green (46 + 27 + 11).
- Project left runnable: `npm run setup && npm run dev`.
