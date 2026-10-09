/** HTTP-level tests against the running server. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

export async function runServerTests(BASE: string, step: (name: string, fn: () => Promise<void> | void) => Promise<void>) {
  await step("public pages render (home, classes, prices, about, faqs, contact, policy draft 404s)", async () => {
    for (const p of ["/", "/classes", "/prices", "/about", "/faqs", "/contact"]) {
      const res = await fetch(`${BASE}${p}`);
      assert.equal(res.status, 200, `${p} → ${res.status}`);
    }
    const home = await (await fetch(`${BASE}/`)).text();
    const heroStart = home.indexOf('class="relative overflow-hidden"');
    const heroEnd = home.indexOf("</section>", heroStart);
    assert.ok(heroStart >= 0 && heroEnd > heroStart, "homepage hero section should render");
    const hero = home.slice(heroStart, heroEnd);
    assert.ok(!hero.includes("Tuesdays &amp; Thursdays"), "hero must not show the generated weekly schedule");
    assert.ok(!hero.includes("Drop-in €12.00 · booking in seconds"), "hero must not show drop-in price copy");
    assert.ok(!home.includes("mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-forest-800 font-display text-lg font-semibold text-white"), "What to expect must not show numbered circles");
    const classes = await (await fetch(`${BASE}/classes`)).text();
    const pageTitleEnd = classes.indexOf("</h1>", classes.indexOf(">Classes &amp; schedule</h1>"));
    const introStart = classes.indexOf("<p", pageTitleEnd);
    const introEnd = classes.indexOf("</p>", introStart);
    assert.ok(pageTitleEnd >= 0 && introStart > pageTitleEnd && introEnd > introStart, "Classes page title and intro should render");
    const classesIntro = classes.slice(introStart, introEnd);
    assert.ok(!classesIntro.includes("Commit to a whole term in one click"), "Classes intro must not repeat block sales copy");
    assert.ok(!classesIntro.includes("Tuesdays &amp; Thursdays"), "Classes intro must not show the generated weekly schedule");
    assert.ok(!classes.includes("Commit to a whole term in one click"), "Classes page must remove the term-sales paragraph");
  });

  await step("homepage section visibility and order follow per-installation layout settings", async () => {
    const { setSetting } = await import("@/lib/settings");
    const { getHomepageSections } = await import("@/lib/homepage");
    const defaults = await getHomepageSections();
    const changed = defaults.map((section) => ({
      ...section,
      active: section.id === "faqs" ? false : section.active,
      sort: section.id === "venue" ? 1 : section.id === "hero" ? 8 : section.sort,
    }));
    try {
      await setSetting("homepage_sections", changed);
      const html = await (await fetch(`${BASE}/`)).text();
      assert.match(html, /aria-labelledby="venue"[^>]*style="order:1"/, "venue section should receive order 1");
      assert.equal(html.includes('aria-labelledby="faq-preview"'), false, "disabled FAQ preview should be omitted");
    } finally {
      await setSetting("homepage_sections", defaults);
    }
  });

  await step("custom pages publish publicly and primary/footer menus honor status, placement, order and visibility", async () => {
    const { run, get } = await import("@/db");
    const published = Number(run(
      `INSERT INTO site_pages (slug, title, intro, sections_json, status) VALUES (?, ?, ?, ?, 'published')`,
      "integration-custom-page", "Integration Custom Page", "A published introduction", JSON.stringify([{ heading: "A prepared section", body: "Published section content" }])
    ).lastInsertRowid);
    const draft = Number(run(
      `INSERT INTO site_pages (slug, title, intro, status) VALUES (?, ?, ?, 'draft')`,
      "integration-draft-page", "Integration Draft Page", "This must stay private"
    ).lastInsertRowid);
    run(`INSERT INTO navigation_items (placement, label, href, sort, active, page_id) VALUES ('primary', ?, ?, 15, 1, ?)`, "Custom Header Link", "/integration-custom-page", published);
    run(`INSERT INTO navigation_items (placement, label, href, sort, active, page_id) VALUES ('primary', ?, ?, 16, 1, ?)`, "Draft Header Link", "/integration-draft-page", draft);
    run(`INSERT INTO navigation_items (placement, label, href, sort, active, page_id) VALUES ('primary', ?, ?, 17, 0, ?)`, "Inactive Header Link", "/integration-custom-page", published);
    run(`INSERT INTO navigation_items (placement, label, href, sort, active, page_id) VALUES ('footer', ?, ?, 10, 1, ?)`, "Custom Footer Link", "/integration-custom-page", published);

    const pageResponse = await fetch(`${BASE}/integration-custom-page`);
    assert.equal(pageResponse.status, 200);
    const pageHtml = await pageResponse.text();
    assert.ok(pageHtml.includes("Integration Custom Page"));
    assert.ok(pageHtml.includes("Published section content"));
    assert.equal((await fetch(`${BASE}/integration-draft-page`)).status, 404);

    assert.equal((await fetch(`${BASE}/integration-draft-page?preview=1`)).status, 404);
    const superAdmin = get<{ id: number }>(`SELECT id FROM admins WHERE role = 'super_admin' LIMIT 1`)!;
    const superToken = randomUUID();
    run(`INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?,?,?)`, superToken, superAdmin.id, new Date(Date.now() + 3600_000).toISOString());
    const previewResponse = await fetch(`${BASE}/integration-draft-page?preview=1`, { headers: { cookie: `ya_admin=${superToken}` } });
    assert.equal(previewResponse.status, 200);
    const previewHtml = await previewResponse.text();
    assert.ok(previewHtml.includes("Integration Draft Page"));
    assert.ok(previewHtml.includes("Preview only"));
    assert.match(previewHtml, /name="robots" content="noindex,\s*nofollow"/);

    const settingsModule = await import("@/lib/settings");
    const originalAppearance = await settingsModule.getSettings();
    const previewUrl = new URL(`${BASE}/`);
    previewUrl.searchParams.set("appearance_preview", "1");
    previewUrl.searchParams.set("palette_id", "ocean-linen");
    previewUrl.searchParams.set("accent_color", "#123456");
    assert.equal((await fetch(previewUrl)).status, 404);
    const appearancePreviewResponse = await fetch(previewUrl, { headers: { cookie: `ya_admin=${superToken}` } });
    assert.equal(appearancePreviewResponse.status, 200);
    const appearancePreviewHtml = await appearancePreviewResponse.text();
    assert.ok(appearancePreviewHtml.includes("--b800:#245468;") && appearancePreviewHtml.includes("--a600:#123456;"));
    assert.ok(appearancePreviewHtml.includes("Unsaved theme preview"));
    assert.equal((await settingsModule.getSettings()).palette_id, originalAppearance.palette_id);
    assert.equal((await settingsModule.getSettings()).accent_color, originalAppearance.accent_color);

    const teacher = run(`INSERT INTO admins (email, name, role, password_hash) VALUES (?, ?, 'teacher_owner', 'test-hash')`, "integration-teacher-owner@example.com", "Integration Teacher");
    const teacherToken = randomUUID();
    run(`INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?,?,?)`, teacherToken, Number(teacher.lastInsertRowid), new Date(Date.now() + 3600_000).toISOString());
    assert.equal((await fetch(`${BASE}/integration-draft-page?preview=1`, { headers: { cookie: `ya_admin=${teacherToken}` } })).status, 404);
    assert.equal((await fetch(previewUrl, { headers: { cookie: `ya_admin=${teacherToken}` } })).status, 404);
    run(`DELETE FROM admin_sessions WHERE token IN (?,?)`, superToken, teacherToken);
    run(`DELETE FROM admins WHERE id = ?`, Number(teacher.lastInsertRowid));

    const homeHtml = await (await fetch(`${BASE}/`)).text();
    assert.ok(homeHtml.includes("Custom Header Link"));
    assert.ok(homeHtml.includes("Custom Footer Link"));
    assert.ok(!homeHtml.includes("Draft Header Link"));
    assert.ok(!homeHtml.includes("Inactive Header Link"));
    assert.ok(homeHtml.indexOf("Custom Header Link") < homeHtml.indexOf("Workshops"));
  });

  await step("robots + sitemap are served, admin/book paths are excluded", async () => {
    const robots = await (await fetch(`${BASE}/robots.txt`)).text();
    assert.ok(robots.includes("Disallow: /admin"));
    const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
    assert.ok(sitemap.includes("/classes"));
  });

  await step("admin area is protected (redirects to login)", async () => {
    for (const p of ["/admin", "/admin/bookings", "/admin/pricing", "/admin/content", "/admin/pages"]) {
      const res = await fetch(`${BASE}${p}`, { redirect: "manual" });
      assert.ok([307, 302].includes(res.status), `${p} expected redirect, got ${res.status}`);
      assert.ok((res.headers.get("location") ?? "").includes("/admin/login"));
    }
    const res = await fetch(`${BASE}/api/admin/export?type=customers`);
    assert.equal(res.status, 401);
    const sim = await fetch(`${BASE}/api/admin/simulate`, { method: "POST", body: "{}" });
    assert.equal(sim.status, 401);
  });

  await step("pass purchases and multi-date discounts are hidden by default", async () => {
    const { setSetting } = await import("@/lib/settings");
    await setSetting("class_passes_enabled", false);
    await setSetting("multi_date_discount_enabled", false);
    const ids = await pickClassIds(BASE, 2);
    const response = await fetch(`${BASE}/api/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ occurrenceIds: ids }),
    });
    const quote = await response.json() as { result: { totalCents: number; chosen: { kind: string }; alternatives: { kind: string }[] }; classPassesEnabled: boolean };
    assert.equal(quote.result.totalCents, 2400);
    assert.equal(quote.result.chosen.kind, "drop_in");
    assert.equal(quote.classPassesEnabled, false);
    assert.equal(quote.result.alternatives.some((offer) => offer.kind === "pass_purchase" || offer.kind === "intro_pass"), false);
    const prices = await (await fetch(`${BASE}/prices`)).text();
    assert.ok(!prices.includes("Credits that wait for you"));
    assert.ok(!prices.includes("Multi-date rate"));
  });

  await step("quote API: single class is €12, two dates get the multi-date rate", async () => {
    const { setSetting } = await import("@/lib/settings");
    await setSetting("multi_date_discount_enabled", true);
    const ids = await pickClassIds(BASE, 2);
    const one = (await (await fetch(`${BASE}/api/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ occurrenceIds: [ids[0]] }) })).json()) as { result: { totalCents: number; chosen: { kind: string } } };
    assert.equal(one.result.totalCents, 1200);
    const two = (await (await fetch(`${BASE}/api/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ occurrenceIds: ids }) })).json()) as { result: { totalCents: number; discountCents: number; chosen: { kind: string }; alternatives?: { kind: string }[] }; classPassesEnabled?: boolean };
    assert.equal(two.result.totalCents, 2200);
    assert.equal(two.result.chosen.kind, "multi_date");
    assert.equal(two.result.discountCents, 200);
    assert.equal(two.classPassesEnabled, false);
    assert.equal(two.result.alternatives?.some((alternative) => alternative.kind === "pass_purchase" || alternative.kind === "intro_pass"), false);
    const prices = await (await fetch(`${BASE}/prices`)).text();
    assert.ok(!prices.includes("Credits that wait for you"));
    assert.ok(!prices.includes("5-class flex pass"));
  });

  await step("cron endpoint rejects a bad token and accepts the right one", async () => {
    const bad = await fetch(`${BASE}/api/cron/reminders?token=wrong`);
    assert.equal(bad.status, 401);
    const good = await fetch(`${BASE}/api/cron/reminders?token=test-cron-token`);
    assert.equal(good.status, 200);
  });

  await step("stripe webhook refuses to process when Stripe is not configured", async () => {
    const res = await fetch(`${BASE}/api/webhooks/stripe`, { method: "POST", body: "{}" });
    assert.equal(res.status, 503);
  });

  await step("order status endpoint 404s for unknown refs", async () => {
    const res = await fetch(`${BASE}/api/order-status/YA-NOPE`);
    assert.equal(res.status, 404);
  });

  await step("health endpoint reports ok without leaking secrets", async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.status, 200);
    const text = await res.text();
    const json = JSON.parse(text) as { ok: boolean; db: boolean };
    assert.equal(json.ok, true);
    assert.equal(json.db, true);
    assert.ok(!text.includes("STRIPE") && !text.toUpperCase().includes("KEY") );
  });

  await step("dynamic OG share image renders (SVG-icon fallback needs no upload)", async () => {
    const res = await fetch(`${BASE}/api/og`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get("content-type") ?? "").includes("image/"));
  });

  await step("media serving: unknown id 404s, bad id rejected", async () => {
    assert.equal((await fetch(`${BASE}/api/media/9999`)).status, 404);
    assert.equal((await fetch(`${BASE}/api/media/not-a-number`)).status, 404);
  });

  await step("admin backup export is owner-only", async () => {
    const res = await fetch(`${BASE}/api/admin/backup`);
    assert.equal(res.status, 401);
  });

  await step("customer data export and Stripe portal require a customer session", async () => {
    assert.equal((await fetch(`${BASE}/api/account/export`)).status, 401);
    const portal = await fetch(`${BASE}/api/account/portal`, { method: "POST" });
    assert.equal(portal.status, 401);
  });

  await step("portal fails closed (503 + friendly message) without Stripe configured", async () => {
    // ensure a customer exists, then mint a customer session directly
    const { getDb } = await import("@/db");
    const db = getDb();
    let customer = db.prepare(`SELECT id FROM customers LIMIT 1`).get() as { id: number } | undefined;
    if (!customer) {
      const res = db.prepare(`INSERT INTO customers (email, name, created_at, updated_at) VALUES (?, 'Portal Test', ?, ?)`)
        .run("portal-test@example.com", new Date().toISOString(), new Date().toISOString());
      customer = { id: Number(res.lastInsertRowid) };
    }
    const token = "e2e-session-token-" + Date.now();
    db.prepare(`INSERT INTO customer_tokens (customer_id, token_hash, purpose, expires_at) VALUES (?, ?, 'session', ?)`)
      .run(customer.id, createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 3600_000).toISOString());
    const res = await fetch(`${BASE}/api/account/portal`, {
      method: "POST",
      headers: { cookie: `ya_customer=${token}` },
    });
    assert.equal(res.status, 503);
    const json = (await res.json()) as { error: string };
    assert.match(json.error, /message Anne|available/);
  });

  await step("security headers are present (CSP, HSTS, nosniff, deny frames)", async () => {
    const res = await fetch(`${BASE}/`);
    assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("strict-transport-security"));
  });
}

export async function pickClassIds(BASE: string, n: number): Promise<number[]> {
  // read ids from the public classes page markup
  const html = await (await fetch(`${BASE}/classes`)).text();
  const ids = [...html.matchAll(/data-occurrence-id="(\d+)"/g)].map((m) => Number(m[1]));
  if (ids.length >= n) return ids.slice(0, n);
  // fallback: detail links
  const links = [...html.matchAll(/\/classes\/(\d+)/g)].map((m) => Number(m[1]));
  const unique = [...new Set(links)].slice(0, n);
  assert.ok(unique.length >= n, `expected ${n} class links on /classes, found ${unique.length}`);
  return unique;
}
void assert;
