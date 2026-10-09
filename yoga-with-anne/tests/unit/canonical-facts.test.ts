import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");

/**
 * Owner-managed business facts must live in ONE canonical place (the database,
 * seeded in src/db/seed.ts). These literals must never reappear in application
 * source where they would silently go stale when Anne edits her details.
 */
const FORBIDDEN = [
  /Ballyowen/, // venue name - canonical: venues table
  /K78 ?N263/i, // eircode - canonical: venues table
  /087 ?763 ?9701/, // phone - canonical: settings
];

/** seed.ts and the settings defaults block are the legitimate homes for launch defaults. */
function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTs(full);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry) && !entry.endsWith(".d.ts")) yield full;
  }
}

test("no hard-coded owner business facts outside the seed", () => {
  const offenders: string[] = [];
  for (const file of walkTs(SRC)) {
    if (file.endsWith(`${"db"}/${"seed"}.ts`)) continue;
    if (file.endsWith(`lib${"/"}settings.ts`)) continue; // canonical defaults object
    const content = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN) {
      if (pattern.test(content)) {
        offenders.push(`${file.replace(SRC, "src")} matches ${pattern}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("weekly schedule wording is derived, not hard-coded in app source", () => {
  // the literal schedule line must only exist in seed content
  const offenders: string[] = [];
  for (const file of walkTs(SRC)) {
    if (file.endsWith(`${"db"}/${"seed"}.ts`)) continue;
    const content = readFileSync(file, "utf8");
    if (/Tuesdays (&|&amp;) Thursdays/.test(content)) {
      offenders.push(file.replace(SRC, "src"));
    }
  }
  assert.deepEqual(offenders, []);
});

test("appearance: every preset defines all colour roles; accent override emits overrides", async () => {
  const { PALETTES, appearanceCss } = await import("@/lib/appearance");
  const roles: string[] = ["--b950","--b900","--b800","--b700","--b600","--t100","--t200","--t300","--a100","--a200","--a500","--a600","--a700","--s50","--s100","--s200","--s300"];
  const varsOf = (p: { vars: Record<string, string> }) => p.vars;
  for (const p of PALETTES) {
    for (const r of roles) {
      assert.ok(/^#[0-9a-fA-F]{6}$/.test(varsOf(p)[r]), `${p.id} missing/invalid ${r}`);
    }
  }
  // hermetic: pin the palette first (the owner may have changed it in admin)
  const { setSetting } = await import("@/lib/settings");
  await setSetting("palette_id", "sage-cream");
  await setSetting("accent_color", null);
  // default palette renders plain hex values
  const css = await appearanceCss();
  assert.ok(css.startsWith("html:root{"), "override selector must beat stylesheet defaults");
  assert.ok(css.includes("--b800:#2f4a3c"), "default palette uses sage values");
  // accent override swaps accent roles and derives shades
  await setSetting("palette_id", "terracotta-sand");
  await setSetting("accent_color", "#123456");
  const themed = await appearanceCss();
  assert.ok(themed.includes("--a600:#123456"), "custom accent applied");
  assert.ok(themed.includes("color-mix(in srgb, #123456"), "accent shades derived");
  assert.ok(themed.includes("--b800:#6b3323"), "palette body still from preset");
  // restore defaults
  await setSetting("palette_id", "sage-cream");
  await setSetting("accent_color", null);
});
