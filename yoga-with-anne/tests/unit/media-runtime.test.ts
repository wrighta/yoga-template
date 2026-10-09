import { test } from "node:test";
import assert from "node:assert/strict";
import { sniffImageMime, validateImageUpload, safeFilename } from "@/lib/media";
import { safeRedirectPath, safeEqual, devPaymentsEnabled } from "@/lib/runtime";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]);

test("image sniffing accepts real JPEG/PNG/WebP magic bytes", () => {
  assert.equal(sniffImageMime(pngBytes), "image/png");
  assert.equal(sniffImageMime(jpegBytes), "image/jpeg");
  assert.equal(sniffImageMime(webpBytes), "image/webp");
});

test("image sniffing rejects non-images regardless of claimed type", () => {
  assert.equal(sniffImageMime(exeBytes), null);
  assert.equal(sniffImageMime(new Uint8Array(4)), null);
});

test("upload validation enforces size and type server-side", () => {
  assert.equal(validateImageUpload(pngBytes, pngBytes.length).ok, true);
  const tooBig = validateImageUpload(pngBytes, 10 * 1024 * 1024);
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) assert.match(tooBig.error, /4 MB/);
  const badType = validateImageUpload(exeBytes, exeBytes.length);
  assert.equal(badType.ok, false);
  if (!badType.ok) assert.match(badType.error, /JPEG, PNG or WebP/);
  assert.equal(validateImageUpload(pngBytes, 0).ok, false);
});

test("filenames are sanitised against traversal", () => {
  assert.equal(safeFilename("../../etc/passwd"), "passwd");
  assert.equal(safeFilename("..\\..\\windows\\win.ini"), "win.ini");
  assert.equal(safeFilename("my photo (final).png"), "my_photo__final_.png");
  assert.equal(safeFilename(null), "image");
});

test("open-redirect guard allows only same-site paths", () => {
  assert.equal(safeRedirectPath("/account/home", "/home"), "/account/home");
  assert.equal(safeRedirectPath(undefined, "/home"), "/home");
  // every dangerous shape falls back
  assert.equal(safeRedirectPath("https://evil.example", "/home"), "/home");
  assert.equal(safeRedirectPath("//evil.example", "/home"), "/home");
  assert.equal(safeRedirectPath("/\\evil.example", "/home"), "/home");
  assert.equal(safeRedirectPath("javascript:alert(1)", "/home"), "/home");
});

test("safeEqual is a constant-time style comparison", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual(undefined, "x"), false);
  assert.equal(safeEqual("", ""), false);
});


test("simulated payments fail closed in production regardless of env", () => {
  const env = process.env as { NODE_ENV?: string; DEV_PAYMENTS?: string };
  const original = { NODE_ENV: env.NODE_ENV, DEV_PAYMENTS: env.DEV_PAYMENTS };
  try {
    env.NODE_ENV = "production";
    env.DEV_PAYMENTS = "1";
    // production NEVER enables it, even with DEV_PAYMENTS=1
    assert.equal(devPaymentsEnabled(), false);
    env.NODE_ENV = "development";
    assert.equal(devPaymentsEnabled(), true); // dev + not disabled → allowed
    env.DEV_PAYMENTS = "0";
    assert.equal(devPaymentsEnabled(), false); // explicit disable honoured
  } finally {
    if (original.NODE_ENV === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = original.NODE_ENV;
    if (original.DEV_PAYMENTS === undefined) delete env.DEV_PAYMENTS;
    else env.DEV_PAYMENTS = original.DEV_PAYMENTS;
  }
});
