# Production checklist

Work top-to-bottom. Items marked **(owner)** need Anne; **(dev)** is quick technical setup.

## 1. Content - replace all placeholder/demo data

- [ ] **(owner)** Delete the seeded **sample classes** (Schedule → Manage → Cancel class on each) and create the real schedule via **Create a recurring series**.
- [ ] **(owner)** Write the About page biography in **Content** (a placeholder paragraph is live).
- [ ] **(owner)** Add a real **portrait photo** and (optionally) a venue/class photo - replace the illustration by uploading media and setting the logo/portrait, or have the dev wire the upload fields to the homepage slots.
- [ ] **(owner)** Add **real testimonials** only, each with the student's permission recorded in the consent note. Nothing shows until published.
- [ ] **(owner)** Review every FAQ answer and all homepage section copy in **Content**.
- [ ] **(owner)** Set the homepage **announcement** (or leave empty).
- [ ] **(owner)** Upload a **homepage hero photo** and **Anne's portrait** (Photos → then choose in Settings) - the illustration fallback is fine, real photos are better.
- [ ] **(owner)** Work through **Admin → Launch readiness** until no red items remain (it checks this list automatically - required booking terms, payments, email, venue facts).
- [ ] **(owner)** Confirm parking/access/equipment facts with the venue before adding them under **Venues** (the seed deliberately ships them empty).
- [ ] **(owner)** Confirm class capacity (currently 12) and the €12 drop-in price in **Pricing**.

## 2. Legal - required before launch

- [ ] **(owner + advisor)** Edit and **legally review** the four policy drafts (Privacy Notice, Cookie Notice, Booking & Cancellation Terms, Website Terms) in **Content** - the templates are starting points, not approved wording.
- [ ] **(owner)** Publish each policy when approved (they stay hidden from the public until then). Booking & Cancellation Terms is what customers accept at checkout.
- [ ] **(owner)** Confirm VAT treatment with the accountant; put the outcome (or nothing) in **Settings → tax note**. The software makes no VAT claim.
- [ ] **(dev)** List the subprocessors actually used in the Privacy Notice: hosting provider, Stripe Payments Europe (payments), Resend (email), DNS/SSL provider.

## 3. Credentials & integrations

- [ ] **(dev)** Production host provisioned per `DEPLOYMENT.md`; `DATABASE_URL` on a persistent disk; site serves over HTTPS.
- [ ] **(owner)** Stripe account activated; **live-mode** API key in the environment (`STRIPE_SECRET_KEY`).
- [ ] **(dev)** Production webhook endpoint created (`/api/webhooks/stripe`, events listed in DEPLOYMENT.md) and `STRIPE_WEBHOOK_SECRET` set.
- [ ] **(dev)** One live test booking: pay with a real card, verify order + booking + email, then refund yourself; check `audit_log` shows `order.paid`.
- [ ] **(dev)** Resend account + verified sending domain; `RESEND_API_KEY`, `EMAIL_FROM` set; confirmation + reminder received in a real inbox (check spam placement).
- [ ] **(dev)** Cron service scheduled against `/api/cron/reminders?token=…` (every 15–30 min).
- [ ] **(dev)** `DEV_PAYMENTS=0` in the production environment (defence in depth - production builds also refuse the simulated page unconditionally, but set it anyway).
- [ ] **(owner)** Change the admin password from the seeded value (**Settings → Change my password**).

## 4. Data protection / GDPR

- [ ] **(owner)** Read the Privacy Notice as published; make sure the retention and deletion promises match how the business will actually operate.
- [ ] **(dev)** Nightly SQLite backup job (`scripts/backup.sh`) + off-site copy configured; **restore tested once** (`scripts/restore.sh`).
- [ ] **(dev)** Confirm `.env` (secrets) is never in the repo or a backup that leaves your control.
- [ ] **(owner)** Decide who (just Anne) has admin accounts; the seeded account is `owner` - add instructor read-only accounts only if wanted.

## 5. Launch checks

- [ ] Book a class end-to-end on a **phone** (the primary journey) with live Stripe.
- [ ] Cancel it inside the cutoff; confirm the refund path and emails.
- [ ] Fill a class to capacity and confirm the waitlist offer email → claim flow.
- [ ] Verify the Google/WhatsApp share preview of a class page (Open Graph metadata renders).
- [ ] Submit the sitemap in Google Search Console; verify the LocalBusiness data with Google's Rich Results test.
- [ ] Set up the uptime monitor.
- [ ] Send Anne a calendar invite for "read `OWNER_GUIDE.md` once" - genuinely, it covers everything. 🙂

## Rollback plan

The site is one process + one DB file. Keep the previous release directory and `.env`; if a deploy misbehaves: stop the service, swap directories, restart. Backups restore the data.
