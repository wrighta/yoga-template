import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./index";

type Migration = { name: string; sql: string };

/**
 * Incremental migrations after the initial schema. Each runs at most once,
 * tracked in the `migrations` table. Schema.sql uses CREATE IF NOT EXISTS so
 * the base schema is safely re-runnable.
 */
const MIGRATIONS: Migration[] = [
  {
    name: "002_series_skip_dates",
    // blackout dates (local YYYY-MM-DD list) honoured when generating a series
    sql: `ALTER TABLE class_series ADD COLUMN skip_dates TEXT`,
  },
  {
    name: "003_class_type_images",
    sql: `ALTER TABLE class_types ADD COLUMN image_media_id INTEGER`,
  },
  {
    name: "004_orders_recovery",
    // late-payment lifecycle: 'refund_required' → 'refunded' (see lib/booking.ts)
    sql: `ALTER TABLE orders ADD COLUMN recovery TEXT`,
  },
  {
    name: "006_block_weekdays",
    sql: `ALTER TABLE class_blocks ADD COLUMN weekdays TEXT`,
  },
  {
    name: "007_workshops_services_roles",
    sql: `ALTER TABLE class_blocks ADD COLUMN kind TEXT NOT NULL DEFAULT 'block';
    ALTER TABLE class_blocks ADD COLUMN description TEXT;
    ALTER TABLE class_blocks ADD COLUMN image_media_id INTEGER;
    ALTER TABLE class_blocks ADD COLUMN early_bird_price_cents INTEGER;
    ALTER TABLE class_blocks ADD COLUMN early_bird_until TEXT;
    ALTER TABLE contact_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'general';
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
    PRAGMA foreign_keys=OFF;
    CREATE TABLE admins_new (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','instructor','teacher')),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO admins_new (id, email, name, role, password_hash, created_at, updated_at)
      SELECT id, email, name, role, password_hash, created_at, updated_at FROM admins;
    DROP TABLE admins;
    ALTER TABLE admins_new RENAME TO admins;
    PRAGMA foreign_keys=ON;`,
  },
  {
    name: "008_offering_publication_status",
    sql: `ALTER TABLE class_series ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('draft','published'));
    ALTER TABLE class_occurrences ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('draft','published'));
    ALTER TABLE class_blocks ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('draft','published'));
    ALTER TABLE block_bundles ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('draft','published'));`,
  },
  {
    name: "009_group_event_attendees",
    sql: `ALTER TABLE bookings ADD COLUMN seat_count INTEGER NOT NULL DEFAULT 1 CHECK (seat_count >= 1);
    CREATE TABLE IF NOT EXISTS booking_attendees (
      id INTEGER PRIMARY KEY,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_booking_attendees_booking ON booking_attendees(booking_id, sort, id);`,
  },
  {
    name: "005_blocks_and_bundles",
    sql: `CREATE TABLE IF NOT EXISTS class_blocks (
      id INTEGER PRIMARY KEY,
      series_id INTEGER NOT NULL REFERENCES class_series(id),
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    ALTER TABLE class_blocks ADD COLUMN weekdays TEXT;
    CREATE INDEX IF NOT EXISTS idx_blocks_series ON class_blocks(series_id, active);
    CREATE TABLE IF NOT EXISTS block_bundles (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS block_bundle_items (
      bundle_id INTEGER NOT NULL REFERENCES block_bundles(id) ON DELETE CASCADE,
      block_id INTEGER NOT NULL REFERENCES class_blocks(id),
      sort INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bundle_id, block_id)
    );`,
  },
  {
    name: "010_explicit_admin_roles",
    sql: `PRAGMA foreign_keys=OFF;
    CREATE TABLE admins_new (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin','teacher_owner','owner','admin','instructor','teacher')),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO admins_new (id, email, name, role, password_hash, created_at, updated_at)
      SELECT id, email, name, role, password_hash, created_at, updated_at FROM admins;
    DROP TABLE admins;
    ALTER TABLE admins_new RENAME TO admins;
    PRAGMA foreign_keys=ON;`,
  },
  {
    name: "011_pages_and_navigation",
    sql: `CREATE TABLE IF NOT EXISTS site_pages (
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
    INSERT OR IGNORE INTO navigation_items (id, placement, label, href, sort, active) VALUES
      (1, 'primary', 'Classes & Schedule', '/classes', 10, 1),
      (2, 'primary', 'Workshops', '/workshops', 20, 1),
      (3, 'primary', 'Prices', '/prices', 30, 1),
      (4, 'primary', 'About Anne', '/about', 40, 1),
      (5, 'primary', 'FAQs', '/faqs', 50, 1),
      (6, 'primary', 'Contact', '/contact', 60, 1);`,
  },
  {
    name: "012_event_transfers",
    sql: `CREATE TABLE IF NOT EXISTS event_transfers (
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
    CREATE INDEX IF NOT EXISTS idx_event_transfers_booking ON event_transfers(booking_id, created_at);`,
  },
  {
    name: "013_retreat_daily_times",
    sql: `ALTER TABLE class_blocks ADD COLUMN daily_times_json TEXT;`,
  },
];

export function migrate(dbPathOverride?: string) {
  const db = getDb(dbPathOverride);
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(schema);

  for (const m of MIGRATIONS) {
    const applied = db
      .prepare(`SELECT 1 FROM migrations WHERE name = ?`)
      .get(m.name);
    if (applied) continue;
    try {
      db.exec(m.sql);
    } catch (e) {
      // "duplicate column" on an old database that already has it - treat as applied
      if (String(e).includes("duplicate column name")) {
        // fall through to record below
      } else {
        throw e;
      }
    }
    db.prepare(`INSERT OR IGNORE INTO migrations (name) VALUES (?)`).run(m.name);
  }

  db.prepare(
    `INSERT OR IGNORE INTO migrations (name) VALUES ('001_initial_schema')`
  ).run();
  return db;
}

const isDirectRun =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!);
if (isDirectRun) {
  migrate();
  console.log("Migration complete:", process.env.DATABASE_URL || "file:./data/app.db");
}
