import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./helpers";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const axeSource = readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");

async function axeScan(page: import("@playwright/test").Page): Promise<{ id: string; impact: string | null; nodes: { target: string[]; failureSummary?: string }[] }[]> {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const results = await (window as unknown as { axe: { run: () => Promise<{ violations: { id: string; impact: string | null; nodes: { target: string[]; failureSummary?: string }[] }[] }> } }).axe.run();
    return results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  });
}

test("public pages have no critical/serious axe violations", async ({ page }) => {
  for (const path of ["/", "/classes", "/prices", "/about", "/faqs", "/contact"]) {
    await gotoHydrated(page, path);
    await expect(page.locator("h1"), `h1 on ${path}`).toBeVisible({ timeout: 30_000 });
    const violations = await axeScan(page);
    const summary = violations.map((v) => `${path}: ${v.id} ${v.nodes.map((node) => `${node.target.join(" ")} ${node.failureSummary ?? ""}`).join(" | ")}`).join("; ");
    expect(summary, summary).toBe("");
  }
});

test("admin login page has no critical/serious axe violations", async ({ page }) => {
  await gotoHydrated(page, "/admin/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  const violations = await axeScan(page);
  expect(violations.map((v) => v.id).join(";")).toBe("");
});
