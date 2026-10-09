# Deployment

This app is deliberately simple to host: one Node process plus one SQLite file. Three viable production shapes are described - pick one.

---

## Option 0 (simplest reliable): Docker Compose

```bash
cp .env.example .env       # fill in ADMIN_PASSWORD, CRON_TOKEN, domain, keys
docker compose up -d --build
```

- The SQLite database lives on the `yoga-data` volume (`/data` inside the container) and survives rebuilds.
- The container runs migrations + idempotent seed at start, then serves on port 3000 (loopback only).
- Built-in `HEALTHCHECK` hits `/api/health` every 30s.
- Automatic HTTPS: put your domain in `Caddyfile`, then `docker compose --profile tls up -d`.
- Nightly backup from the host cron: `scripts/backup.sh` (see Backups below). Restore with `scripts/restore.sh`.
- The simulated test-payment page **cannot** run under compose (`DEV_PAYMENTS=0` is enforced in `docker-compose.yml`, and production builds refuse it regardless).

For a single small business this is the lowest-risk path: the app, proxy and volume are all one `docker compose` file.

---

## Option A: single VPS with a persistent disk (no Docker)

Works on any small Linux box (Hetzner ~€4/mo, DigitalOcean, Racknerd, an existing Mac mini, etc.).

### 1. Server basics

```bash
# Node.js 22 LTS or newer (node:sqlite is built in)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
git clone <your-repo> yoga && cd yoga && npm ci
```

### 2. Environment

Create `.env` beside the app (see `.env.example` for every variable):

```ini
DATABASE_URL=file:/var/data/yoga/app.db      # persistent disk, NOT inside the repo
NEXT_PUBLIC_SITE_URL=https://yogawithanne.ie
ADMIN_EMAIL=anne@yogawithanne.ie
ADMIN_PASSWORD=<strong unique password>
CRON_TOKEN=<long random string>
DEV_PAYMENTS=0
# after Stripe + Resend are set up below:
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
EMAIL_FROM="Yoga with Anne <hello@yogawithanne.ie>"
```

### 3. Database + build + run

```bash
npm run setup     # creates/migrates the DB and seeds the owner admin + content
npm run build
npx next start -p 3000   # keep alive with systemd/pm2
```

systemd unit ( `/etc/systemd/system/yoga.service`):

```ini
[Unit]
Description=Yoga with Anne
After=network.target
[Service]
WorkingDirectory=/opt/yoga
EnvironmentFile=/opt/yoga/.env
ExecStart=/usr/bin/npx next start -p 3000
Restart=always
[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now yoga
```

### 4. Reverse proxy + HTTPS (Caddy is simplest)

```
yogawithanne.ie {
    reverse_proxy localhost:3000
}
```

Caddy obtains and renews certificates automatically. The app already sends `X-Frame-Options`, `nosniff` and friends; the proxy adds TLS.

### 5. Backups (non-negotiable)

The whole business database is one file. Nightly:

```bash
0 2 * * * sqlite3 /var/data/yoga/app.db ".backup /var/backups/yoga-$(date +\%F).db" && find /var/backups -name 'yoga-*.db' -mtime +30 -delete
```

Copy the backup directory off-box (rclone to any cloud storage / rsync to another machine). Test a restore quarterly: stop the app, swap the file, start it.

---

## Option B: managed Next.js (Vercel) + managed Postgres

If you prefer not to run a server:

1. Create a Postgres database (Supabase/Neon) and port the schema (`src/db/schema.sql` translates almost verbatim; `TEXT` timestamps and integer cents stay as-is).
2. Swap the driver in `src/db/index.ts` from `node:sqlite` to a Postgres client (`postgres` or `pg`) - every query in the codebase is standard SQL through that one module. `BEGIN IMMEDIATE` becomes a normal transaction; the busy-retry loop can be removed.
3. Deploy to Vercel, set the environment variables in the dashboard, run `src/db/migrate.ts` + `seed.ts` once locally against the production `DATABASE_URL`.
4. Scheduled jobs: point a free cron service (e.g. Vercel Cron / cron-job.org) at `https://your-site/api/cron/reminders?token=…` every 15–30 minutes.

---

## Stripe (test first, then live)

1. Create a Stripe account for the business; keep **test mode** on while verifying.
2. Test mode: copy the secret key into `.env` (Stripe replaces the built-in test-pay page automatically).
3. Run a local webhook listener while testing:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   Put the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
4. Go-live: activate the account, switch API keys to live, and create a **production webhook endpoint** at `https://your-site/api/webhooks/stripe` subscribed to at least:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
5. Copy the production signing secret into `STRIPE_WEBHOOK_SECRET` and restart.
6. Verify once in live mode with a real card (refund yourself after) and check `audit_log` recorded `order.paid`.

Memberships use Stripe Billing subscriptions; cancellations by the owner are managed in the Stripe dashboard (the customer's `stripe_subscription_id` is on their membership row).

## Email (Resend)

1. Create a Resend account, add and verify your sending domain (DNS records they provide).
2. Create an API key → `RESEND_API_KEY`, and set `EMAIL_FROM`.
3. Send a test booking; confirm it arrives and appears in `/admin/messages` with status `sent`.
4. Reminders: ensure the cron URL from the section above is scheduled (every 15 min is plenty) - or use the admin button daily.

## Domain, DNS, monitoring

- Point the domain's A/AAAA or CNAME record at your host; enable HTTPS.
- Free uptime check (UptimeRobot etc.) on `https://your-site/` pinging every 5 minutes.
- `GET /api/cron/reminders?token=…` returning 401/200 is a good secondary health probe.

## Health, logging and updates

- `GET /api/health` → `{ok:true, db:true}` (200) or 503 - wire it to an uptime monitor and the Docker HEALTHCHECK.
- The app logs operational failures (email send errors, backup problems) without personal data.
- Graceful restarts are safe: SQLite WAL persists uncommitted-but-committed transactions; `systemctl restart` / `docker compose up -d --build` is the update path (`git pull && npm ci && npm run db:migrate && npm run build && restart` outside Docker).

## Backups (also applies to Docker)

```bash
# host cron (adjust paths):
15 2 * * * /opt/yoga/scripts/backup.sh /var/data /var/backups/yoga
```

- `scripts/backup.sh` takes a consistent online snapshot (`sqlite3 .backup`), prunes after 30 days.
- `scripts/restore.sh <backup.db> <data-dir>` restores **interactively** - it asks you to type RESTORE and keeps a safety copy of the current database first.
- Anne can also download a fresh backup any time from **Admin → Launch readiness → Download backup now** (owner-only endpoint).

## Scheduled jobs summary

| Job | Endpoint | Cadence |
| --- | --- | --- |
| Release expired holds, expire waitlist offers, send class reminders | `GET /api/cron/reminders?token=…` | every 15–30 min |

All three jobs are also safe to trigger from the admin Dashboard button.

## First production data

The seed only creates future **sample** classes (clearly marked "Sample date generated from the weekly series"). Replace them with your real schedule: delete sample dates in **Schedule → Manage → Cancel class**, then create your real series. Re-running `npm run db:seed` never deletes anything - it only tops up future dates for series that exist.

## Upgrades

```bash
git pull && npm ci && npm run db:migrate && npm run build && sudo systemctl restart yoga
```
(`db:migrate` is idempotent; the seed can be run any time to top up future dates.)
