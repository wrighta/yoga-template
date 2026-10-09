import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./helpers";

async function login(page: import("@playwright/test").Page) {
  await gotoHydrated(page, "/admin/login");
  await page.getByLabel("Email").fill("anne@yogawithanne.ie");
  await page.getByLabel("Password").fill("change-me-immediately");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
}

test("booking requires a mobile number", async ({ page }) => {
  await gotoHydrated(page, "/classes");
  await page.locator('input[type="checkbox"]').nth(0).check();
  await gotoHydrated(page, "/book");
  await page.getByLabel("Full name").fill("No Phone");
  await page.getByLabel("Email").fill("no-phone@example.com");
  await page.getByRole("checkbox", { name: /I accept the booking/ }).check();
  // "123" passes the browser's required check but fails server validation
  await page.getByLabel("Mobile number").fill("123");
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await expect(page.getByText(/add your mobile number/i)).toBeVisible();
  // a real number lets it through
  await page.getByLabel("Mobile number").fill("087 555 0101");
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.waitForURL(/\/book\/pay\//);
});

test("colour palette switching restyles the public site; accent override works", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/appearance");

  await page.getByRole("radio", { name: /Ocean & Linen/ }).check();
  await page.locator('input[name="accent_color"]').fill("#123456");
  const previewPagePromise = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Preview homepage" }).click();
  const previewPage = await previewPagePromise;
  await previewPage.waitForLoadState("domcontentloaded");
  await expect(previewPage.getByText("Unsaved theme preview · live colours have not changed.")).toBeVisible();
  await expect(previewPage.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const previewColors = await previewPage.evaluate(() => ({
    brand: getComputedStyle(document.documentElement).getPropertyValue("--b800").trim(),
    accent: getComputedStyle(document.documentElement).getPropertyValue("--a600").trim(),
  }));
  expect(previewColors).toEqual({ brand: "#245468", accent: "#123456" });
  await previewPage.close();

  await gotoHydrated(page, "/");
  const unchanged = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--b800").trim());
  expect(unchanged).toBe("#2f4a3c");

  // switch to Terracotta & Sand
  await gotoHydrated(page, "/admin/appearance");
  await page.getByRole("radio", { name: /Terracotta & Sand/ }).check();
  await page.getByRole("button", { name: "Save colours" }).click();
  await expect(page.getByText("Colours saved")).toBeVisible();

  await gotoHydrated(page, "/");
  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--b800").trim()
  );
  expect(bg).toBe("#6b3323");

  // custom accent overrides the accent roles
  await gotoHydrated(page, "/admin/appearance");
  await page.locator('input[name="accent_color"]').fill("#123456");
  await page.getByRole("button", { name: "Save colours" }).click();
  await expect(page.getByText("Colours saved")).toBeVisible();
  await gotoHydrated(page, "/");
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--a600").trim()
  );
  expect(accent).toBe("#123456");

  await gotoHydrated(page, "/admin/appearance");
  await page.getByRole("radio", { name: /Forest & Tangerine/ }).check();
  await page.getByLabel(/Use the palette's own accent/).check();
  await page.getByRole("button", { name: "Save colours" }).click();
  await expect(page.getByText("Colours saved")).toBeVisible();
  await gotoHydrated(page, "/");
  const forestPalette = await page.evaluate(() => ({
    brand: getComputedStyle(document.documentElement).getPropertyValue("--b800").trim(),
    accent: getComputedStyle(document.documentElement).getPropertyValue("--a600").trim(),
    illustrationSurface: getComputedStyle(document.querySelector('svg[aria-label="Illustration of a seated meditation posture"] circle')!).fill,
  }));
  expect(forestPalette).toEqual({ brand: "#20543a", accent: "#bd4e21", illustrationSurface: "rgb(220, 236, 223)" });

  // restore classic palette + accent
  await gotoHydrated(page, "/admin/appearance");
  await page.getByRole("radio", { name: /Sage & Cream/ }).check();
  await page.getByLabel(/Use the palette's own accent/).check();
  await page.getByRole("button", { name: "Save colours" }).click();
  await expect(page.getByText("Colours saved")).toBeVisible();
  await gotoHydrated(page, "/");
  const restored = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--b800").trim()
  );
  expect(restored).toBe("#2f4a3c");
});

test("memberships toggle hides memberships from the public prices page", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/settings");
  const box = page.getByRole("checkbox", { name: /Memberships enabled/ });
  await box.uncheck();
  await page.getByRole("button", { name: "Save all settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await gotoHydrated(page, "/prices");
  await expect(page.getByText(/Monthly membership/)).toHaveCount(0);
  await expect(page.getByText(/Annual membership/)).toHaveCount(0);

  // class passes remain hidden by default
  await expect(page.getByText(/5-class flex pass/)).toHaveCount(0);

  // restore: memberships back on (this install was set up with them)
  await gotoHydrated(page, "/admin/settings");
  await page.getByRole("checkbox", { name: /Memberships enabled/ }).check();
  await page.getByRole("button", { name: "Save all settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await gotoHydrated(page, "/prices");
  await expect(page.getByText(/Monthly membership/).first()).toBeVisible();
});
