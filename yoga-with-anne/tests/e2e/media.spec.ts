import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./helpers";

/** A minimal valid 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function login(page: import("@playwright/test").Page) {
  await gotoHydrated(page, "/admin/login");
  await page.getByLabel("Email").fill("anne@yogawithanne.ie");
  await page.getByLabel("Password").fill("change-me-immediately");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
}

test("owner can upload, rename and delete a photo", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/media");

  const uploader = page.locator("form").filter({ has: page.locator("#media-file") });
  await page.locator("#media-file").setInputFiles({ name: "hall-photo.png", mimeType: "image/png", buffer: PNG });
  await uploader.getByLabel(/Alt text/).fill("The hall set up for class");
  await uploader.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("1 image uploaded.")).toBeVisible();

  // appears in the library with the alt text
  await expect(page.locator('img[alt="The hall set up for class"]')).toHaveCount(1);

  // upload validation: a non-image is rejected with a friendly message
  await page.locator("#media-file").setInputFiles({ name: "not-an-image.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await uploader.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(/Only JPEG, PNG or WebP/)).toBeVisible();

  // delete it again (never referenced)
  const deleteButtons = page.getByRole("button", { name: "Delete image" });
  const count = await deleteButtons.count();
  await deleteButtons.first().click();
  await expect(page.locator('img[alt="The hall set up for class"]')).toHaveCount(0);
  void count;
});

test("teacher can upload and select an event image inline", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/classes/new");
  await page.locator("#workshop summary").click();
  await page.locator("#workshop").getByRole("button", { name: "Choose image" }).click();
  await page.locator('#workshop input[type="file"]').setInputFiles({ name: "inline-retreat.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("status").filter({ hasText: "Photo uploaded and selected." })).toBeVisible();
  await expect(page.locator('#workshop input[name="imageMediaId"]')).not.toHaveValue("");
  await expect(page.locator('#workshop img[alt="inline retreat"]')).toHaveCount(1);
});

test("photos larger than 1 MB upload successfully (Server Action body limit raised)", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/media");
  const uploader = page.locator("form").filter({ has: page.locator("#media-file") });

  // build a genuine ~1900×1900 noise PNG in the browser (~3 MB) whose re-encoded
  // upload body exceeds the old 1 MB Server Action default
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1900;
    canvas.height = 1900;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(1900, 1900);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.floor(Math.random() * 256);
      img.data[i + 1] = Math.floor(Math.random() * 256);
      img.data[i + 2] = Math.floor(Math.random() * 256);
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    canvas.toBlob(
      (blob) => {
        const file = new File([blob!], "big-hall-photo.png", { type: "image/png" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.querySelector("#media-file") as HTMLInputElement;
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      "image/png"
    );
  });
  // the uploader re-encodes to JPEG, so the preview shows the .jpg name
  await expect(page.getByText(/big-hall-photo\.jpg/)).toBeVisible();
  await uploader.getByLabel(/Alt text/).fill("Large noise photo");
  await uploader.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("1 image uploaded.")).toBeVisible({ timeout: 15_000 });
  // it really is in the library and served back
  await expect(page.locator('img[alt="Large noise photo"]')).toHaveCount(1);
});

test("oversized photos are rejected with a clear message BEFORE uploading", async ({ page }) => {
  await login(page);
  await gotoHydrated(page, "/admin/media");

  const before = await page.locator('img[alt^="Library image"], li img').count().catch(() => 0);

  // a 21 MB "photo" - rejected instantly by the pre-submit size check
  await page.evaluate(() => {
    const huge = new File([new Uint8Array(21 * 1024 * 1024)], "huge-photo.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(huge);
    const input = document.querySelector("#media-file") as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const warning = page.getByTestId("media-too-big");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("huge-photo.png");
  await expect(warning).toContainText("Too big to upload");
  // nothing was uploaded - the submit button is disabled with no valid selection
  await expect(page.getByRole("button", { name: /No photos to upload/ })).toBeVisible();
  const after = await page.locator('img[alt^="Library image"], li img').count().catch(() => 0);
  expect(after).toBe(before);
});
