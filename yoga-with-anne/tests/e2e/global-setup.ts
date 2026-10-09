/** Fresh DB + schema + seed for the E2E run (mirrors the integration runner). */
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

for (const f of ["data/e2e.db", "data/e2e.db-wal", "data/e2e.db-shm"]) {
  if (existsSync(f)) rmSync(f);
}
const env = { ...process.env, DATABASE_URL: "file:./data/e2e.db" };
execSync("npx tsx src/db/migrate.ts", { env, stdio: "pipe" });
execSync("npx tsx src/db/seed.ts", { env, stdio: "pipe", input: "" });
execSync("npx tsx tests/e2e/publish-terms.ts", { env, stdio: "pipe" });
console.log("E2E database ready.");
