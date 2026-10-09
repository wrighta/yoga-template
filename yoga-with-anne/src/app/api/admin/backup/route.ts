import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireAdmin, canWrite } from "@/lib/auth";
import { getDb, audit } from "@/db";

/**
 * Owner-accessible database backup. Produces a consistent snapshot using
 * SQLite's VACUUM INTO (safe while the app is live), streamed once, then the
 * temp file is deleted. Owner-only; never publicly reachable.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin || !canWrite(admin.role)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "yoga-backup-"));
    const target = join(dir, `yoga-backup-${new Date().toISOString().slice(0, 10)}.db`);
    getDb().prepare(`VACUUM INTO ?`).run(target);
    const bytes = readFileSync(target);
    audit("backup.downloaded", { actorType: "admin", actor: admin.email });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="yoga-backup-${new Date().toISOString().slice(0, 10)}.db"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[backup] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "Backup failed - see server logs." }, { status: 500 });
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

void randomUUID;
