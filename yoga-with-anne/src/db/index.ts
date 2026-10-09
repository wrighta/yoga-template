import { DatabaseSync } from "node:sqlite";

export type Row = Record<string, unknown>;
type SQLParam = string | number | bigint | Uint8Array | null;

let _db: DatabaseSync | null = null;
let _path: string | null = null;

export function dbPathFromEnv(): string {
  const raw = process.env.DATABASE_URL || "file:./data/app.db";
  return raw.startsWith("file:") ? raw.slice(5) : raw;
}

export function getDb(pathOverride?: string): DatabaseSync {
  const path = pathOverride ?? dbPathFromEnv();
  if (_db && _path === path) return _db;
  _db = new DatabaseSync(path);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA busy_timeout = 8000");
  _path = path;
  return _db;
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...(params as SQLParam[])) as T[];
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...(params as SQLParam[])) as T | undefined;
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
  try {
    const res = getDb().prepare(sql).run(...(params as SQLParam[]));
    return { changes: Number(res.changes), lastInsertRowid: res.lastInsertRowid };
  } catch (e) {
    const err = e as Error;
    throw new Error(`${err.message} [SQL: ${sql.slice(0, 160)} | params: ${JSON.stringify(params).slice(0, 200)}]`, { cause: e });
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Serialised write transaction (SQLite: BEGIN IMMEDIATE takes the write lock immediately).
 *  Retries briefly on SQLITE_BUSY so concurrent writers queue instead of failing. */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      db.exec("BEGIN IMMEDIATE");
    } catch (e) {
      lastError = e;
      if (String(e).includes("within a transaction")) throw e;
      const wait = 25 * (attempt + 1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
      continue;
    }
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw e;
    }
  }
  throw lastError ?? new Error("Transaction lock timeout");
}

export function audit(
  action: string,
  opts: {
    actorType?: "admin" | "system" | "customer";
    actor?: string;
    entityType?: string;
    entityId?: string | number;
    detail?: unknown;
  } = {}
) {
  run(
    "INSERT INTO audit_log (actor_type, actor, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?,?)",
    opts.actorType ?? "system",
    opts.actor ?? null,
    action,
    opts.entityType ?? null,
    opts.entityId != null ? String(opts.entityId) : null,
    opts.detail ? JSON.stringify(opts.detail) : null
  );
}
