import type { Page } from "@playwright/test";

/**
 * Navigate and wait until React has hydrated, so clicks/checkboxes reliably
 * trigger client handlers (essential on the dev server used by E2E).
 */
export async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 30_000 });
}
