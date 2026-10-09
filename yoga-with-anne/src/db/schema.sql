-- Yoga with Anne - initial schema (SQLite)
-- Money is stored as integer cents (EUR). Timestamps are UTC ISO-8601 text.
-- Presentation-timezone is stored in site settings (Europe/Dublin).

CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,             -- JSON
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin','teacher_owner','owner','admin','instructor','teacher')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  phone TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  consent_source TEXT,
  consent_version TEXT,
  consent_at TEXT,
  anonymised INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT UNIQUE,
  notes_admin TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS customer_tokens (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'magic_login',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS instructors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  bio TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  postcode TEXT,
  map_url TEXT,
  parking_notes TEXT,
  access_notes TEXT,
  directions TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS class_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  suitability TEXT,
  what_to_bring TEXT,
  accessibility_note TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  image_media_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS class_series (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  class_type_id INTEGER REFERENCES class_types(id),
  venue_id INTEGER REFERENCES venues(id),
  instructor_id INTEGER REFERENCES instructors(id),
  weekdays TEXT NOT NULL,            -- JSON array of ISO weekdays 1=Mon..7=Sun
  start_time TEXT NOT NULL,          -- local 'HH:MM' in site timezone
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 12,
  effective_from TEXT,
  effective_to TEXT,
  booking_close_hours_before REAL NOT NULL DEFAULT 1,
  price_override_cents INTEGER,
  waitlist_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('draft','published')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS class_occurrences (
  id INTEGER PRIMARY KEY,
  series_id INTEGER REFERENCES class_series(id),
  class_type_id INTEGER NOT NULL REFERENCES class_types(id),
  venue_id INTEGER REFERENCES venues(id),
  instructor_id INTEGER REFERENCES instructors(id),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,           -- UTC ISO
  ends_at TEXT NOT NULL,             -- UTC ISO
  capacity INTEGER NOT NULL DEFAULT 12,
  booking_open_at TEXT,
  booking_close_at TEXT,
  price_override_cents INTEGER,
  waitlist_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('draft','published')),
  notes_public TEXT,
  notes_admin TEXT,
  source TEXT NOT NULL DEFAULT 'series',  -- 'series' | 'manual'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_occ_series_slot ON class_occurrences(series_id, starts_at) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_occ_starts ON class_occurrences(starts_at);

CREATE TABLE IF NOT EXISTS class_blocks (
  id INTEGER PRIMARY KEY,
  series_id INTEGER NOT NULL REFERENCES class_series(id),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,          -- local YYYY-MM-DD (inclusive)
  end_date TEXT NOT NULL,            -- local YYYY-MM-DD (inclusive)
  price_cents INTEGER NOT NULL,      -- price for the WHOLE block
  weekdays TEXT,                     -- JSON array of ISO weekdays; NULL = all series days
  kind TEXT NOT NULL DEFAULT 'block', -- 'block' | 'workshop'
  description TEXT,                   -- itinerary and details, shown on the public event page
  summary TEXT,                       -- short teaser shown on listing cards
  image_media_id INTEGER,
  early_bird_price_cents INTEGER,     -- optional discounted price
  early_bird_until TEXT,              -- date the early-bird offer ends
  daily_times_json TEXT,              -- optional retreat schedule: shared time or per-date times
  active INTEGER NOT NULL DEFAULT 1,
  publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('draft','published')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_blocks_series ON class_blocks(series_id, active);

CREATE TABLE IF NOT EXISTS block_bundles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,      -- price for ALL included blocks
  active INTEGER NOT NULL DEFAULT 1,
  publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('draft','published')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS block_bundle_items (
  bundle_id INTEGER NOT NULL REFERENCES block_bundles(id) ON DELETE CASCADE,
  block_id INTEGER NOT NULL REFERENCES class_blocks(id),
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, block_id)
);

CREATE TABLE IF NOT EXISTS capacity_holds (
  id INTEGER PRIMARY KEY,
  occurrence_id INTEGER NOT NULL REFERENCES class_occurrences(id) ON DELETE CASCADE,
  order_id INTEGER,
  qty INTEGER NOT NULL DEFAULT 1,
  email TEXT,
  expires_at TEXT NOT NULL,
  released INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_holds_occ ON capacity_holds(occurrence_id, released, expires_at);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('drop_in','pass','membership')),
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  credits INTEGER,                   -- passes: number of class credits
  validity_weeks INTEGER,            -- passes: weeks from purchase
  eligibility TEXT NOT NULL DEFAULT 'all',  -- 'all' | 'new_customer'
  recurrence TEXT,                   -- memberships: 'monthly' | 'annual'
  allowed_class_type_ids TEXT,       -- memberships: JSON array; empty/null = all regular classes
  active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS discount_rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'multi_date',
  min_distinct_dates INTEGER NOT NULL DEFAULT 2,
  max_distinct_dates INTEGER NOT NULL DEFAULT 4,
  per_class_cents INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value REAL NOT NULL,               -- percent 0-100 or fixed cents
  min_total_cents INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  max_redemptions INTEGER,
  times_redeemed INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','awaiting_payment','paid','cancelled','expired')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  pricing_snapshot TEXT,             -- JSON: full explanation of chosen price structure
  coupon_id INTEGER REFERENCES coupons(id),
  recurring_consent INTEGER NOT NULL DEFAULT 0,
  offline INTEGER NOT NULL DEFAULT 0,
  checkout_mode TEXT,                -- 'stripe' | 'test' | 'offline'
  stripe_session_id TEXT UNIQUE,
  recovery TEXT,                     -- late-payment lifecycle: NULL | 'refund_required' | 'refunded'
  expires_at TEXT,
  paid_at TEXT,
  policy_versions TEXT,              -- JSON [{slug,version}]
  notes_admin TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- 'class' | 'pass' | 'membership' | 'entitlement' | 'discount_note'
  occurrence_id INTEGER REFERENCES class_occurrences(id),
  product_id INTEGER REFERENCES products(id),
  description TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  provider TEXT NOT NULL,            -- 'stripe' | 'offline' | 'test'
  provider_ref TEXT UNIQUE,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded','refunded_part')),
  method TEXT,
  note_admin TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  amount_cents INTEGER NOT NULL,
  provider TEXT,
  provider_ref TEXT UNIQUE,
  reason TEXT,
  actor TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  occurrence_id INTEGER NOT NULL REFERENCES class_occurrences(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_id INTEGER REFERENCES orders(id),
  order_item_id INTEGER,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','attended','no_show')),
  seat_count INTEGER NOT NULL DEFAULT 1 CHECK (seat_count >= 1),
  source TEXT NOT NULL DEFAULT 'online',  -- 'online' | 'admin' | 'waitlist' | 'pass' | 'membership'
  price_cents INTEGER NOT NULL DEFAULT 0, -- charged for this seat at confirmation (0 if covered by pass/membership)
  reminder_sent_at TEXT,
  notes_admin TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_unique_seat ON bookings(occurrence_id, customer_id) WHERE status IN ('confirmed','attended');
CREATE INDEX IF NOT EXISTS idx_booking_occ ON bookings(occurrence_id, status);

CREATE TABLE IF NOT EXISTS booking_attendees (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_booking_attendees_booking ON booking_attendees(booking_id, sort, id);

CREATE TABLE IF NOT EXISTS event_transfers (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  from_occurrence_id INTEGER NOT NULL REFERENCES class_occurrences(id),
  to_occurrence_id INTEGER NOT NULL REFERENCES class_occurrences(id),
  previous_paid_cents INTEGER NOT NULL,
  replacement_price_cents INTEGER NOT NULL,
  refund_due_cents INTEGER NOT NULL DEFAULT 0,
  settlement_status TEXT NOT NULL DEFAULT 'settled' CHECK (settlement_status IN ('settled','refund_due')),
  adjustment_order_id INTEGER REFERENCES orders(id),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_transfers_booking ON event_transfers(booking_id, created_at);

CREATE TABLE IF NOT EXISTS passes (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  order_id INTEGER REFERENCES orders(id),
  credits_total INTEGER NOT NULL,
  valid_from TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS pass_credit_ledger (
  id INTEGER PRIMARY KEY,
  pass_id INTEGER NOT NULL REFERENCES passes(id),
  delta INTEGER NOT NULL,            -- negative = used, positive = granted/returned
  reason TEXT NOT NULL,
  booking_id INTEGER REFERENCES bookings(id),
  order_id INTEGER REFERENCES orders(id),
  actor TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  order_id INTEGER REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','cancelled','expired')),
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_subscription_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id INTEGER PRIMARY KEY,
  occurrence_id INTEGER NOT NULL REFERENCES class_occurrences(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','claimed','expired','cancelled')),
  position INTEGER NOT NULL,
  offered_at TEXT,
  offer_expires_at TEXT,
  offer_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_active ON waitlist_entries(occurrence_id, customer_id) WHERE status IN ('waiting','offered');

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  image_media_id INTEGER,
  link TEXT NOT NULL DEFAULT '/classes',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS site_pages (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  intro TEXT,
  hero_media_id INTEGER,
  sections_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS navigation_items (
  id INTEGER PRIMARY KEY,
  placement TEXT NOT NULL CHECK (placement IN ('primary','footer')),
  label TEXT NOT NULL,
  href TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  page_id INTEGER REFERENCES site_pages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_navigation_placement ON navigation_items(placement, active, sort, id);

CREATE TABLE IF NOT EXISTS content_blocks (
  id INTEGER PRIMARY KEY,
  page TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,               -- JSON (string or structured)
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (page, key)
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY,
  quote TEXT NOT NULL,
  attribution TEXT,
  consent_note TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  filename TEXT,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  alt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  heading TEXT,
  body_html TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY,
  to_email TEXT NOT NULL,
  template_key TEXT,
  subject TEXT,
  html TEXT,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','preview','sent','failed','suppressed')),
  provider TEXT,
  error TEXT,
  related_type TEXT,
  related_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  requires_acceptance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS policy_acceptances (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  order_id INTEGER REFERENCES orders(id),
  policy_slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'general', -- 'general' | 'enquiry'
  name TEXT,
  email TEXT,
  phone TEXT,
  message TEXT NOT NULL,
  ip TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','done')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_type TEXT NOT NULL DEFAULT 'system',  -- 'admin' | 'system' | 'customer'
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail TEXT,                       -- JSON
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,               -- Stripe event id - webhook idempotency
  type TEXT,
  payload TEXT,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
