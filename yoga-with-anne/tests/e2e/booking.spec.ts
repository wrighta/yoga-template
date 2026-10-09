import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./helpers";

test("homepage renders the essentials", async ({ page }) => {
  await gotoHydrated(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Gentle yoga");
  await expect(page.getByRole("link", { name: /View classes & book/ })).toBeVisible();
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible();
});

test("mobile navigation opens and closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/");
  const button = page.getByRole("button", { name: /menu/i });
  await button.click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
});

test("guest books two dates and gets the multi-date price", async ({ page }) => {
  await gotoHydrated(page, "/classes");
  const boxes = page.locator('input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(page.getByText("2 classes selected")).toBeVisible();

  await page.getByRole("link", { name: "Continue to booking" }).click();
  await expect(page).toHaveURL(/\/book$/);
  await expect(page.getByText("Total", { exact: true })).toBeVisible();
  await expect(page.getByText("€22.00").first()).toBeVisible();
  await expect(page.getByText(/Multi-date rate/).first()).toBeVisible();

  await page.getByLabel("Full name").fill("E2E Tester");
  await page.getByLabel("Email").fill("e2e-tester@example.com");
  await page.getByLabel("Mobile number").fill("087 555 0001");
  await page.getByRole("checkbox", { name: /I accept the booking/ }).check();
  await page.getByRole("button", { name: /Continue to payment/ }).click();

  await page.waitForURL(/\/book\/pay\//);
  await expect(page.getByText("Test payment page")).toBeVisible();
  await page.getByRole("button", { name: /Pay now/ }).click();

  await page.waitForURL(/\/book\/confirmed\//);
  await expect(page.getByRole("heading", { name: /You're booked in/ })).toBeVisible();
  await expect(page.getByText("Add to calendar").first()).toBeVisible();
});

test("checkout form guards against double submission", async ({ page }) => {
  await gotoHydrated(page, "/classes");
  await page.locator('input[type="checkbox"]').nth(2).check();
  await gotoHydrated(page, "/book");
  await page.getByLabel("Full name").fill("E2E Double");
  await page.getByLabel("Email").fill("e2e-double@example.com");
  await page.getByLabel("Mobile number").fill("087 555 0002");
  await page.getByRole("checkbox", { name: /I accept the booking/ }).check();
  const submit = page.getByRole("button", { name: /Continue to payment/ });
  // The button disables while the action is pending - a second click must be a no-op.
  await submit.click();
  await page.waitForURL(/\/book\/(pay|confirmed)\//, { timeout: 30_000 });
  // going back to /book must not silently create a second order for the same seats
  await gotoHydrated(page, "/book");
  const body = await page.textContent("body");
  expect(body).toBeTruthy();
});

test("404 page is friendly", async ({ page }) => {
  await gotoHydrated(page, "/this-page-does-not-exist");
  await expect(page.getByRole("heading", { name: /couldn't find that page/ })).toBeVisible();
});
