import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "off",
  },
  webServer: {
    // Dev server so the development-only test payments are available (production
    // builds fail closed - see src/lib/runtime.ts).
    command: "npx tsx tests/e2e/global-setup.ts && npx next dev -p 3200",
    url: "http://127.0.0.1:3200/api/health",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: "file:./data/e2e.db",
      NEXT_DIST_DIR: ".next-e2e",
      DEV_PAYMENTS: "1",
      CRON_TOKEN: "e2e-cron-token",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
