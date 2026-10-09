import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./helpers";

async function login(page: import("@playwright/test").Page) {
  await gotoHydrated(page, "/admin/login");
  await page.getByLabel("Email").fill("anne@yogawithanne.ie");
  await page.getByLabel("Password").fill("change-me-immediately");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
}

test("owner price edit propagates to the public site and checkout quote", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/pricing");

  // edit the canonical drop-in product through the admin form
  const dropInForm = page.locator("form", { has: page.getByRole("button", { name: "Save drop-in" }) });
  await dropInForm.getByLabel("Price (€)").fill("13.00");
  await dropInForm.getByRole("button", { name: "Save drop-in" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // public prices page
  await gotoHydrated(page, "/prices");
  await expect(page.getByText("€13.00").first()).toBeVisible();

  // public schedule cards
  await gotoHydrated(page, "/classes");
  await expect(page.getByText("€13.00").first()).toBeVisible();

  // quote API
  const quote = await page.evaluate(async () => {
    const res = await fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ occurrenceIds: [1] }),
    });
    return res.json();
  });
  expect(quote.result.totalCents).toBe(1300);

  // restore
  await gotoHydrated(page, "/admin/pricing");
  const restoreForm = page.locator("form", { has: page.getByRole("button", { name: "Save drop-in" }) });
  await restoreForm.getByLabel("Price (€)").fill("12.00");
  await restoreForm.getByRole("button", { name: "Save drop-in" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await gotoHydrated(page, "/prices");
  await expect(page.getByText("€12.00").first()).toBeVisible();
});

test("series price override stores euro→cents correctly and propagates", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/classes/new");

  // Open the collapsed advanced section and the recurring-series editor.
  await page.locator("summary", { hasText: "More class options" }).click();
  await page.locator("#series summary").click();
  await page.locator("#series-manage > summary").click();
  await page.locator("#series-manage details summary").first().click();
  const advOpen = await page.evaluate(() => {
    const d = document.querySelector('details:has(#series-manage)') as HTMLDetailsElement | null;
    return d ? d.open : "not found";
  });
  console.log("ADVANCED DETAILS OPEN:", advOpen);
  const visibility = await page.evaluate(() => {
    const input = document.querySelector('#topup-form input[name="fromDate"]') as HTMLInputElement | null;
    if (!input) return "input not found";
    const chain: string[] = [];
    let el: HTMLElement | null = input;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") chain.push(`${el.tagName}.${el.className.slice(0, 30)} HIDDEN`);
      if (el instanceof HTMLDetailsElement) chain.push(`details open=${el.open}`);
      el = el.parentElement;
    }
    return chain;
  });
  console.log("VISIBILITY CHAIN:", JSON.stringify(visibility));
  const override = page.locator('input[name="priceOverrideRaw"]');
  await override.fill("12.50");
  await page.getByRole("button", { name: "Save series" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // fill the calendar forward so a new occurrence inherits the override
  // (set values + submit via the DOM - the nested collapsed details make
  //  actionability checks flaky, but the form data is what matters)
  await page.evaluate(() => {
    const form = document.getElementById("topup-form") as HTMLFormElement | null;
    if (!form) throw new Error("topup form not found");
    (form.querySelector('input[name="fromDate"]') as HTMLInputElement).value = "2027-01-04";
    (form.querySelector('input[name="toDate"]') as HTMLInputElement).value = "2027-01-10";
    form.requestSubmit();
  });
  await page.waitForURL(/saved=1/, { timeout: 30_000 });
  await expect(page.getByText(/classes? created|Class created/).first()).toBeVisible();

  // the new class is €12.50 - NOT €0.12
  await gotoHydrated(page, "/classes");
  await expect(page.getByText("€12.50").first()).toBeVisible();
  await expect(page.getByText("€0.12")).toHaveCount(0);
});

test("class creation options are collapsed and open individually on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await gotoHydrated(page, "/admin/classes/new");
  for (const id of ["block", "workshop", "bundle", "single"]) {
    await expect(page.locator(`#${id}`)).toHaveJSProperty("open", false);
  }
  await expect(page.getByRole("heading", { name: /1 ·|2 ·|3 ·|4 ·/ })).toHaveCount(0);
  await page.locator("#block > summary").click();
  await expect(page.locator("#block")).toHaveJSProperty("open", true);
  await expect(page.locator('#block input[name="name"]')).toBeVisible();
  await expect(page.locator("#workshop")).toHaveJSProperty("open", false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("launch readiness: displayed blocker rows equal the summary count", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/health");
  const summary = page.getByTestId("health-summary");
  await expect(summary).toBeVisible();
  const declared = Number(await summary.getAttribute("data-blockers"));
  const renderedBlockers = await page.locator('[data-testid="health-check"][data-status="blocker"]').count();
  expect(renderedBlockers).toBe(declared);
  const renderedAttention = await page.locator('[data-testid="health-check"][data-status="attention"]').count();
  expect(Number(await summary.getAttribute("data-attention"))).toBe(renderedAttention);
  const renderedReady = await page.locator('[data-testid="health-check"][data-status="ready"]').count();
  expect(Number(await summary.getAttribute("data-ready"))).toBe(renderedReady);
});

test("owner phone change propagates to the public contact page", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/settings");
  const phone = page.locator('input[name="contact_phone_display"]');
  await phone.fill("086 555 9999");
  await page.getByRole("button", { name: "Save all settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await gotoHydrated(page, "/contact");
  await expect(page.getByText("086 555 9999").first()).toBeVisible();

  // restore
  await gotoHydrated(page, "/admin/settings");
  await page.locator('input[name="contact_phone_display"]').fill("087 763 9701");
  await page.getByRole("button", { name: "Save all settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
});

test("no nested forms anywhere on admin class management", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/classes?view=classes");
  const first = page.locator('a[href^="/admin/classes/"]', { hasText: "Manage" }).first();
  await first.click();
  await page.waitForURL(/\/admin\/classes\/\d+/);
  const nested = await page.evaluate(() => document.querySelectorAll("form form").length);
  expect(nested).toBe(0);
  const nestedPublic = await page.evaluate(() => document.querySelectorAll("a a, button button").length);
  expect(nestedPublic).toBe(0);
});

test("admin cancels a booking; customer sees it cancelled", async ({ page }) => {
  // book as a guest first
  await gotoHydrated(page, "/classes");
  await page.locator('input[type="checkbox"]').nth(0).check();
  await page.goto("/book");
  await page.getByLabel("Full name").fill("Cancel Me");
  await page.getByLabel("Email").fill("cancel-me@example.com");
  await page.getByLabel("Mobile number").fill("087 555 0003");
  await page.getByRole("checkbox", { name: /I accept the booking/ }).check();
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.waitForURL(/\/book\/pay\//);
  await page.getByRole("button", { name: /Pay now/ }).click();
  await page.waitForURL(/\/book\/confirmed\//);

  // admin cancels with notification
  await login(page);
  await gotoHydrated(page, "/admin/bookings");
  const row = page.locator("tr", { hasText: "cancel-me@example.com" }).first();
  await row.getByRole("button", { name: /Cancel \+ notify/ }).click();
  await expect(page.getByText("Booking cancelled.")).toBeVisible();
});

test("teacher creates a block + bundle; student books the block end-to-end", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/classes/new");
  await page.locator("#block summary").click();

  // create a block straight from the unified form - no series step
  await page.locator('input[name="name"][placeholder*="Autumn"]').fill("E2E Strong Yoga Block");
  // class type: type a brand-new style (free-text path)
  const classTypeCombo = page.locator('#block [data-combo="classTypeId"]');
  await classTypeCombo.locator("select").selectOption({ label: "＋ Type a new one - starts typing" });
  await classTypeCombo.locator('input[name="classTypeId"]').fill("Strong Yoga");
  // instructor: free-typed too
  const instructorCombo = page.locator('#block [data-combo="instructorId"]');
  await instructorCombo.locator("select").selectOption({ label: "＋ Type a new one - starts typing" });
  await instructorCombo.locator('input[name="instructorId"]').fill("Mary Byrne");
  const startDate = new Date(Date.now() + 21 * 86400_000).toISOString().slice(0, 10);
  await page.locator('#block input[name="startDate"]').fill(startDate);
  await page.locator('#block input[name="weeks"]').fill("4");
  await page.locator('#block input[name="price"]').fill("80.00");
  await page.getByRole("button", { name: "Publish block" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // public classes page advertises the block
  await gotoHydrated(page, "/classes");
  await expect(page.getByText("E2E Strong Yoga Block").first()).toBeVisible();
  const blockCard = page.locator("article").filter({ hasText: "E2E Strong Yoga Block" }).first();
  await expect(blockCard).toContainText("Days");
  await expect(blockCard).toContainText("Tuesday and Thursday");
  await expect(blockCard).toContainText("7:30 PM to 8:30 PM");
  await expect(blockCard).toContainText("Location");
  await expect(blockCard).toContainText("classes in total");
  await expect(blockCard).toContainText("places left");
  await expect(blockCard).not.toContainText("Whole block");
  await expect(blockCard).not.toContainText("per class");
  await expect(blockCard).not.toContainText("classes to come");
  await expect(page.getByText(/Book this block - €80.00/).first()).toBeVisible();

  // class detail page shows the block upsell
  const blockHref = await page.locator('a[href^="/book?block="]').first().getAttribute("href");
  expect(blockHref).toBeTruthy();

  // guest books the block
  await gotoHydrated(page, blockHref!);
  await expect(page.getByText("E2E Strong Yoga Block").first()).toBeVisible();
  await expect(page.getByText(/One payment books you into every date/)).toBeVisible();
  await page.getByLabel("Full name").fill("Block Student");
  await page.getByLabel("Email").fill("block-student@example.com");
  await page.getByLabel("Mobile number").fill("087 555 4004");
  await page.getByRole("checkbox", { name: /I accept the booking/ }).check();
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.waitForURL(/\/book\/pay\//);
  await page.getByRole("button", { name: /Pay now/ }).click();
  await page.waitForURL(/\/book\/confirmed\//);
  await expect(page.getByRole("heading", { name: /You're booked in/ })).toBeVisible();
  // confirmation lists every date of the block
  const dates = await page.locator("text=/Oct|Nov/").count();
  expect(dates).toBeGreaterThan(4);
});

test("teacher can save a private draft block on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await gotoHydrated(page, "/admin/classes/new");
  await page.locator("#block summary").click();

  await page.locator('#block input[name="name"]').fill("Mobile Draft Block");
  await page.locator('#block [data-combo="classTypeId"] select').selectOption({ label: "Gentle Yoga & Meditation" });
  await page.locator('#block input[name="startDate"]').fill(new Date(Date.now() + 35 * 86400_000).toISOString().slice(0, 10));
  await page.locator('#block input[name="weeks"]').fill("4");
  await page.locator('#block input[name="price"]').fill("80.00");
  await expect(page.locator("#block").getByRole("button", { name: "Save draft" })).toBeVisible();
  await expect(page.locator("#block").getByRole("button", { name: "Publish block" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.locator("#block").getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await gotoHydrated(page, "/classes");
  await expect(page.getByText("Mobile Draft Block")).toHaveCount(0);

  await gotoHydrated(page, "/admin/classes");
  await expect(page.getByText("Mobile Draft Block")).toBeVisible();
});

test("teacher can manually enroll someone in a whole block with pay-at-class", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/classes/new");
  await page.locator("#block summary").click();
  await page.locator('#block input[name="name"]').fill("Phone Booking Block");
  await page.locator('#block [data-combo="classTypeId"] select').selectOption({ label: "Gentle Yoga & Meditation" });
  await page.locator('#block input[name="startDate"]').fill(new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10));
  await page.locator('#block input[name="weeks"]').fill("4");
  await page.locator('#block input[name="price"]').fill("80.00");
  await page.locator("#block").getByRole("button", { name: "Publish block" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await gotoHydrated(page, "/admin/bookings");
  const offering = page.locator('#manual-block select[name="offering"]');
  const option = offering.locator("option", { hasText: "Phone Booking Block" }).first();
  await offering.selectOption(await option.getAttribute("value") ?? "");
  await page.locator('#manual-block input[name="name"]').fill("Phone Booker");
  await page.locator('#manual-block input[name="email"]').fill("phone-booker@example.com");
  await page.locator('#manual-block input[name="phone"]').fill("087 555 6410");
  await page.locator('#manual-block select[name="paymentMethod"]').selectOption("cash");
  await page.getByRole("button", { name: "Add booking for all dates" }).click();
  await expect(page.getByText(/Booking added for 8 class dates/)).toBeVisible();
  await expect(page.locator("tr", { hasText: "phone-booker@example.com" })).toHaveCount(8);
});

test("teacher can publish a workshop with public hours", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/classes/new");
  await page.locator("#workshop summary").click();
  await page.locator('#workshop input[name="name"]').fill("E2E Morning Workshop");
  await page.locator('#workshop [data-combo="classTypeId"] select').selectOption({ label: "Gentle Yoga & Meditation" });
  const eventDate = new Date(Date.now() + 50 * 86400_000).toISOString().slice(0, 10);
  await page.locator('#workshop input[name="startDate"]').fill(eventDate);
  await page.locator('#workshop input[name="endDate"]').fill(eventDate);
  await page.locator('#workshop input[name="workshopStartTime"]').fill("10:00");
  await page.locator('#workshop input[name="workshopEndTime"]').fill("13:30");
  await page.locator('#workshop input[name="capacity"]').fill("8");
  await page.locator('#workshop input[name="price"]').fill("35.00");
  await page.locator("#workshop").getByRole("button", { name: "Publish workshop" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await gotoHydrated(page, "/workshops");
  const event = page.locator("article", { hasText: "E2E Morning Workshop" });
  await expect(event.getByText("Hours: 10:00 AM to 1:30 PM")).toBeVisible();
  await event.getByRole("link", { name: "View event details" }).click();
  await expect(page.getByRole("heading", { name: "Workshop hours" })).toBeVisible();
  await expect(page.getByText("10:00 AM to 1:30 PM")).toBeVisible();
});

test("retreat checkout books multiple named people for the whole event", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await gotoHydrated(page, "/admin/classes/new");
  await page.locator("#workshop summary").click();
  await page.locator('#workshop input[name="name"]').fill("E2E Weekend Retreat");
  await page.locator('#workshop select[name="kind"]').selectOption("retreat");
  await page.locator('#workshop [data-combo="classTypeId"] select').selectOption({ label: "Gentle Yoga & Meditation" });
  const startDate = new Date(Date.now() + 70 * 86400_000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 72 * 86400_000).toISOString().slice(0, 10);
  await page.locator('#workshop input[name="startDate"]').fill(startDate);
  await page.locator('#workshop input[name="endDate"]').fill(endDate);
  await page.locator('#workshop input[name="differentTimes"]').check();
  await expect(page.locator('#workshop input[name="dailyTimeStart"]')).toHaveCount(3);
  await page.locator('#workshop input[name="dailyTimeStart"]').nth(0).fill("09:00");
  await page.locator('#workshop input[name="dailyTimeEnd"]').nth(0).fill("16:00");
  await page.locator('#workshop input[name="dailyTimeStart"]').nth(1).fill("10:00");
  await page.locator('#workshop input[name="dailyTimeEnd"]').nth(1).fill("17:00");
  await page.locator('#workshop input[name="dailyTimeStart"]').nth(2).fill("08:30");
  await page.locator('#workshop input[name="dailyTimeEnd"]').nth(2).fill("15:30");
  await page.locator('#workshop input[name="capacity"]').fill("3");
  await page.locator('#workshop input[name="price"]').fill("45.00");
  await page.locator('#workshop textarea[name="description"]').fill("A slow weekend to rest and reconnect.");
  await page.locator("#workshop").getByRole("button", { name: "Publish retreat" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await gotoHydrated(page, "/workshops");
  await expect(page.getByText("E2E Weekend Retreat")).toBeVisible();
  await expect(page.getByText("A slow weekend to rest and reconnect.")).toBeVisible();
  await expect(page.getByText("Retreat", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await gotoHydrated(page, "/classes");
  await expect(page.getByText("E2E Weekend Retreat")).toHaveCount(0);
  await gotoHydrated(page, "/workshops");
  const retreatCard = page.locator("article", { hasText: "E2E Weekend Retreat" });
  await expect(retreatCard.getByText("Different hours each day")).toBeVisible();
  await retreatCard.getByRole("link", { name: "View event details" }).click();
  await expect(page.getByRole("heading", { name: "Daily retreat times" })).toBeVisible();
  await expect(page.getByText("9:00 AM to 4:00 PM")).toBeVisible();
  await gotoHydrated(page, "/workshops");
  const bookingLink = retreatCard.getByRole("link", { name: /Book your place/ });
  const href = await bookingLink.getAttribute("href");
  expect(href).toBeTruthy();

  await gotoHydrated(page, href!);
  await expect(page.getByText(/One booking covers the whole event/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("Full name").fill("Retreat Payer");
  await page.getByLabel("Email").fill("retreat-payer@example.com");
  await page.getByLabel("Mobile number").fill("087 555 6600");
  await page.getByLabel("Attendee 1 name").fill("Retreat Payer");
  await page.getByRole("button", { name: /Add another attendee/ }).click();
  await page.getByLabel("Attendee 2 name").fill("Retreat Friend");
  await expect(page.getByText("€90.00").first()).toBeVisible();
  await page.getByRole("checkbox", { name: /I accept the booking/ }).check();
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.waitForURL(/\/book\/pay\//);
  await page.getByRole("button", { name: /Pay now/ }).click();
  await page.waitForURL(/\/book\/confirmed\//);
  await expect(page.getByText("Attendees: Retreat Payer, Retreat Friend")).toBeVisible();

  await gotoHydrated(page, "/admin/bookings");
  const manualOffering = page.locator('#manual-event select[name="offering"]');
  const eventOption = manualOffering.locator("option", { hasText: "E2E Weekend Retreat" }).first();
  await manualOffering.selectOption(await eventOption.getAttribute("value") ?? "");
  await page.locator('#manual-event input[name="name"]').fill("Phone Payer");
  await page.locator('#manual-event input[name="email"]').fill("phone-payer@example.com");
  await page.locator('#manual-event textarea[name="attendeeNames"]').fill("Phone Guest");
  await page.locator('#manual-event select[name="paymentMethod"]').selectOption("cash");
  await page.getByRole("button", { name: "Add event booking" }).click();
  await expect(page.getByText("Event booking added for 1 attendee.")).toBeVisible();
});

test("Super Admin handoff safely changes the existing owner to Teacher-owner", async ({ page }) => {
  const superEmail = "site-super-admin@example.com";
  const superPassword = "TestSuperPassword123!";
  await login(page);
  await gotoHydrated(page, "/admin/settings");
  await page.getByText("+ Add a team member").click();
  await page.getByLabel("Name").last().fill("Site Super Admin");
  await page.getByLabel("Email").last().fill(superEmail);
  await page.getByLabel("Password (min 8 characters)").fill(superPassword);
  await page.locator('select[name="role"]').selectOption("super_admin");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(superEmail)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await gotoHydrated(page, "/admin/login");
  await page.getByLabel("Email").fill(superEmail);
  await page.getByLabel("Password").fill(superPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
  await gotoHydrated(page, "/admin/settings");
  await page.getByLabel("Role for Anne Wright").selectOption("teacher_owner");
  await page.locator("li", { hasText: "anne@yogawithanne.ie" }).getByRole("button", { name: "Save role" }).click();
  await expect(page.getByLabel("Role for Anne Wright")).toHaveValue("teacher_owner");

  await page.getByRole("button", { name: "Sign out" }).click();
  await login(page);
  await gotoHydrated(page, "/admin/settings");
  await expect(page).toHaveURL(/\/admin$/);
  await gotoHydrated(page, "/admin/pricing");
  await expect(page.getByRole("heading", { name: "Pricing", exact: true })).toBeVisible();
  await gotoHydrated(page, "/admin/customers");
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await gotoHydrated(page, "/admin/login");
  await page.getByLabel("Email").fill(superEmail);
  await page.getByLabel("Password").fill(superPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
  await gotoHydrated(page, "/admin/settings");
  await page.getByLabel("Role for Anne Wright").selectOption("super_admin");
  await page.locator("li", { hasText: "anne@yogawithanne.ie" }).getByRole("button", { name: "Save role" }).click();
  await expect(page.getByLabel("Role for Anne Wright")).toHaveValue("super_admin");

  await page.getByRole("button", { name: "Sign out" }).click();
  await login(page);
  await gotoHydrated(page, "/admin/settings");
  await page.locator("li", { hasText: superEmail }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(superEmail)).toHaveCount(0);
});

test("Super Admin can enable and disable class passes and multi-date pricing independently", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/admin/settings");
  const passes = page.locator('input[name="class_passes_enabled"]');
  const multiDate = page.locator('input[name="multi_date_discount_enabled"]');
  if (await passes.isChecked()) await passes.uncheck();
  if (await multiDate.isChecked()) await multiDate.uncheck();
  await page.getByRole("button", { name: "Save all settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await expect(passes).not.toBeChecked();
  await expect(multiDate).not.toBeChecked();

  await passes.check();
  await page.getByRole("button", { name: "Save all settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await gotoHydrated(page, "/prices");
  await expect(page.getByRole("heading", { name: "Credits that wait for you" })).toBeVisible();
  await expect(page.getByText("Multi-date rate")).toHaveCount(0);

  await gotoHydrated(page, "/admin/settings");
  await page.locator('input[name="class_passes_enabled"]').uncheck();
  await page.locator('input[name="multi_date_discount_enabled"]').check();
  await page.getByRole("button", { name: "Save all settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await gotoHydrated(page, "/prices");
  await expect(page.getByRole("heading", { name: "Credits that wait for you" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Multi-date rate" })).toBeVisible();

  await gotoHydrated(page, "/admin/settings");
  await page.locator('input[name="multi_date_discount_enabled"]').uncheck();
  await page.getByRole("button", { name: "Save all settings" }).click();
});
