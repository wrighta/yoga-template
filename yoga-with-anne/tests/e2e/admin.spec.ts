import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const ADMIN_EMAIL = "anne@yogawithanne.ie";
const ADMIN_PASSWORD = "change-me-immediately";

test("admin requires login, wrong password rejected", async ({ page }) => {
  await gotoHydrated(page, "/admin");
  await page.waitForURL(/\/admin\/login/);
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Email or password is incorrect/)).toBeVisible();
});

test("admin can sign in, see dashboard, health and media pages", async ({ page }) => {
  await gotoHydrated(page, "/admin/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await gotoHydrated(page, "/admin/health");
  await expect(page.getByRole("heading", { name: "Launch readiness" })).toBeVisible();
  await expect(page.getByText(/Admin password/)).toBeVisible();

  await gotoHydrated(page, "/admin/media");
  await expect(page.getByRole("heading", { name: /Photos & images/ })).toBeVisible();

  await gotoHydrated(page, "/admin/venues");
  await expect(page.getByText("Ballyowen Castle Community Centre").first()).toBeVisible();

  await gotoHydrated(page, "/admin/pricing");
  await expect(page.getByRole("button", { name: "Simulate price" })).toBeVisible();
});

test("pricing simulator reflects the multi-date rule", async ({ page }) => {
  await gotoHydrated(page, "/admin/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
  await gotoHydrated(page, "/admin/pricing");
  await page.locator("#pricing-sim-seats").fill("2").catch(() => undefined);
  await page.getByRole("button", { name: "Simulate price" }).click();
  await expect(page.getByText(/Total: €22\.00/)).toBeVisible();
});

test("Super Admin creates a published page and places it in primary and footer navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/admin/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
  await gotoHydrated(page, "/admin/pages");

  await page.getByText("Create a page", { exact: true }).click();
  const createPageForm = page.locator("details form");
  await createPageForm.getByLabel("Page title").fill("Super Admin Editor Test");
  await createPageForm.getByLabel("URL slug").fill("super-admin-editor-test");
  await createPageForm.getByLabel("Introduction").fill("Created from the page editor.");
  await createPageForm.locator('textarea[name="sectionBody"]').first().fill("Prepared page section text.");
  await createPageForm.locator('textarea[name="sectionBody"]').nth(1).fill("Earlier prepared section text.");
  await createPageForm.locator('input[name="sectionOrder"]').first().fill("2");
  await createPageForm.locator('input[name="sectionOrder"]').nth(1).fill("1");
  await createPageForm.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/\/admin\/pages\?saved=1/);

  await page.getByRole("link", { name: "Preview draft" }).click();
  await page.waitForURL(/\/super-admin-editor-test\?preview=1/);
  await expect(page.getByText("Preview only · This page is not visible to visitors until published.")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await gotoHydrated(page, "/admin/pages");
  const pageEditor = page.locator("form").filter({ hasText: "Current: draft" });
  await expect(pageEditor).toHaveCount(1);
  await pageEditor.getByRole("button", { name: "Publish" }).click();
  await page.waitForURL(/\/admin\/pages\?saved=1/);
  await expect(page.getByText("Current: published")).toBeVisible();

  const addMenuForm = page.locator("form").filter({ has: page.locator("#new-menu-label") });
  await addMenuForm.getByLabel("Label").fill("Editor Test Page");
  await addMenuForm.getByLabel("Internal URL").fill("/super-admin-editor-test");
  await addMenuForm.getByLabel("Linked custom page").selectOption({ label: "Super Admin Editor Test (/super-admin-editor-test)" });
  await addMenuForm.getByLabel("Placement").selectOption("primary");
  await addMenuForm.getByRole("button", { name: "Add menu item" }).click();
  await page.waitForURL(/\/admin\/pages\?saved=1/);

  await gotoHydrated(page, "/admin/pages");
  const addFooterForm = page.locator("form").filter({ has: page.locator("#new-menu-label") });
  await addFooterForm.getByLabel("Label").fill("Editor Test Footer");
  await addFooterForm.getByLabel("Internal URL").fill("/super-admin-editor-test");
  await addFooterForm.getByLabel("Linked custom page").selectOption({ label: "Super Admin Editor Test (/super-admin-editor-test)" });
  await addFooterForm.getByLabel("Placement").selectOption("footer");
  const footerSave = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/admin/pages");
  await addFooterForm.getByRole("button", { name: "Add menu item" }).click();
  const footerResponse = await footerSave;
  expect([200, 303]).toContain(footerResponse.status());
  await page.waitForURL(/\/admin\/pages\?(saved|error)=/);
  expect(page.url()).toContain("?saved=1");

  await gotoHydrated(page, "/super-admin-editor-test");
  await expect(page.getByRole("heading", { name: "Super Admin Editor Test" })).toBeVisible();
  await expect(page.getByText("Prepared page section text.")).toBeVisible();
  const sections = page.locator("article > div > section");
  await expect(sections.nth(0)).toContainText("Earlier prepared section text.");
  await expect(sections.nth(1)).toContainText("Prepared page section text.");

  await gotoHydrated(page, "/admin/content");
  const heroButtons = page.locator("form").filter({ has: page.locator('input[name="primaryLabel"]') });
  await heroButtons.locator('input[name="primaryLabel"]').fill("Explore Yin Yoga");
  await heroButtons.locator('input[name="primaryHref"]').fill("/super-admin-editor-test");
  await heroButtons.locator('input[name="secondaryActive"]').uncheck();
  await heroButtons.getByRole("button", { name: "Save hero buttons" }).click();
  await page.waitForURL(/\/admin\/content\?saved=hero-buttons/);

  const services = page.locator("#services");
  const serviceForm = services.locator("form").filter({ has: page.locator('input[name="id"]') }).first();
  await serviceForm.locator('select[name="link"]').selectOption("/super-admin-editor-test");
  await serviceForm.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/admin\/content\?saved=services/);

  const serviceHeadingForm = page.locator("form").filter({ has: page.locator('input[name="key"][value="services_heading"]') });
  await serviceHeadingForm.locator('input[name="value"]').fill("Classes and retreats");
  await serviceHeadingForm.getByRole("button", { name: "Save heading" }).click();
  await page.waitForURL(/\/admin\/content\?saved=home\.services_heading/);

  await gotoHydrated(page, "/");
  await expect(page.getByRole("heading", { name: "Classes and retreats" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore Yin Yoga" })).toHaveAttribute("href", "/super-admin-editor-test");
  await expect(page.getByRole("link", { name: "New to yoga? Start here" })).toHaveCount(0);
  await expect(page.locator('a[href="/super-admin-editor-test"]').filter({ hasText: "Regular Classes" })).toHaveCount(1);

  await gotoHydrated(page, "/admin/content");
  const resetButtons = page.locator("form").filter({ has: page.locator('input[name="primaryLabel"]') });
  await resetButtons.locator('input[name="primaryLabel"]').fill("View classes & book");
  await resetButtons.locator('input[name="primaryHref"]').fill("/classes");
  await resetButtons.locator('input[name="secondaryLabel"]').fill("New to yoga? Start here");
  await resetButtons.locator('input[name="secondaryHref"]').fill("/#new-here");
  await resetButtons.locator('input[name="secondaryActive"]').check();
  await resetButtons.getByRole("button", { name: "Save hero buttons" }).click();
  await page.waitForURL(/\/admin\/content\?saved=hero-buttons/);

  const resetService = page.locator("#services form").filter({ has: page.locator('input[name="id"]') }).first();
  await resetService.locator('select[name="link"]').selectOption("/classes");
  await resetService.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/admin\/content\?saved=services/);
  const resetHeading = page.locator("form").filter({ has: page.locator('input[name="key"][value="services_heading"]') });
  await resetHeading.locator('input[name="value"]').fill("Explore classes and experiences");
  await resetHeading.getByRole("button", { name: "Save heading" }).click();
  await page.waitForURL(/\/admin\/content\?saved=home\.services_heading/);

  await gotoHydrated(page, "/super-admin-editor-test");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Editor Test Page" })).toBeVisible();
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Editor Test Footer" })).toBeVisible();
});

test("Super Admin changes homepage section order and visibility on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/admin/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
  await gotoHydrated(page, "/admin/content");

  const layout = page.locator("form").filter({ has: page.locator("#home-venue-sort") });
  await layout.locator('input[name="venue_sort"]').fill("1");
  await layout.locator('input[name="hero_sort"]').fill("8");
  await layout.locator('input[name="faqs_active"]').uncheck();
  await layout.getByRole("button", { name: "Save homepage layout" }).click();
  await page.waitForURL(/\/admin\/content\?saved=homepage-layout/);

  await gotoHydrated(page, "/");
  const venueTop = await page.locator('[aria-labelledby="venue"]').evaluate((element) => element.getBoundingClientRect().top);
  const classesTop = await page.locator('[aria-labelledby="next-classes"]').evaluate((element) => element.getBoundingClientRect().top);
  expect(venueTop).toBeLessThan(classesTop);
  await expect(page.locator('[aria-labelledby="faq-preview"]')).toHaveCount(0);

  await gotoHydrated(page, "/admin/content");
  const reset = page.locator("form").filter({ has: page.locator("#home-venue-sort") });
  const defaultOrder: Record<string, number> = { hero: 1, services: 2, classes: 3, expect: 4, suits: 5, pricing: 6, meet: 7, venue: 8, testimonials: 9, faqs: 10, newsletter: 11 };
  for (const [id, order] of Object.entries(defaultOrder)) await reset.locator(`input[name="${id}_sort"]`).fill(String(order));
  await reset.locator('input[name="faqs_active"]').check();
  await reset.getByRole("button", { name: "Save homepage layout" }).click();
  await page.waitForURL(/\/admin\/content\?saved=homepage-layout/);
});

test("Super Admin setup and booking screens fit a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/admin/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);

  for (const path of ["/admin/bookings", "/admin/classes/new", "/admin/content", "/admin/pages", "/admin/appearance"]) {
    await gotoHydrated(page, path);
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    const overflow = dimensions.scrollWidth > dimensions.width ? await page.evaluate(() => {
      return [...document.querySelectorAll<HTMLElement>("body *")].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.right <= document.documentElement.clientWidth + 1) return [];
        let clipped = false;
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(parent).overflowX)) { clipped = true; break; }
        }
        return clipped ? [] : [{ tag: element.tagName, className: String(element.className).slice(0, 80), width: Math.round(rect.width), left: Math.round(rect.left), right: Math.round(rect.right), overflowX: getComputedStyle(element).overflowX }];
      }).sort((a, b) => b.right - a.right).slice(0, 10);
    }) : [];
    expect(dimensions.scrollWidth, `${path} should not create page-level horizontal scrolling: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(dimensions.width);
  }
});
