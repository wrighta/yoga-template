/**
 * Integration test runner.
 * Boots the production server against a fresh test database and exercises
 * real flows over HTTP + the domain layer. Exits non-zero on any failure.
 */
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const BUILD_DIR = ".next-integration";
const TEST_DIR = mkdtempSync(join(tmpdir(), "yoga-with-anne-integration-"));
const DB = `file:${join(TEST_DIR, "test.db")}`;

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function step(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    console.error(`  ✖ ${name}\n      ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function waitForServer(url: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server did not start in time");
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function main() {
  process.env.DATABASE_URL = DB;
  process.env.NEXT_DIST_DIR = BUILD_DIR;
  process.env.DEV_PAYMENTS = "1";
  process.env.CRON_TOKEN = "test-cron-token";
  process.env.SUPPRESS_CUSTOMER_EMAILS = "0";
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RESEND_API_KEY;

  const env = { ...process.env };
  let server: ReturnType<typeof spawn> | null = null;
  try {
    rmSync(join(ROOT, BUILD_DIR), { recursive: true, force: true });
    execSync("npx next build", { cwd: ROOT, env, stdio: "inherit" });
    execSync("npx tsx src/db/migrate.ts", { cwd: ROOT, env, stdio: "pipe" });
    execSync("npx tsx src/db/seed.ts", { cwd: ROOT, env, stdio: "pipe" });
    // Test environments publish booking terms explicitly; a dedicated test
    // verifies that checkout remains blocked while required policies are drafts.
    execSync("npx tsx tests/integration/publish-terms.ts", { cwd: ROOT, env, stdio: "pipe" });

    const port = await availablePort();
    const base = `http://127.0.0.1:${port}`;
    server = spawn("npx", ["next", "start", "-p", String(port)], {
      cwd: ROOT,
      env,
      stdio: "inherit",
      detached: true,
    });
    await waitForServer(`${base}/faqs`);

    const { runServerTests } = await import("./server-tests");
    await runServerTests(base, step);
    const { runDomainTests } = await import("./domain-tests");
    await runDomainTests(base, step);
    const { runFixPassTests } = await import("./fixpass-tests");
    await runFixPassTests(base, step);
  } finally {
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    rmSync(join(ROOT, BUILD_DIR), { recursive: true, force: true });
    rmSync(TEST_DIR, { recursive: true, force: true });
  }

  console.log(`\nIntegration: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
