import { all } from "@/db";
import { Card, Alert, Field } from "@/components/ui";
import { fmtEuro } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { saveProductAction, toggleProductAction, saveDiscountRuleAction, saveCouponAction } from "@/app/admin/actions";
import { PricingSimulator } from "./pricing-simulator";
import { requireBusinessAdminPage } from "@/lib/auth";

export default async function AdminPricingPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireBusinessAdminPage();
  const sp = await searchParams;
  const settings = await getSettings();
  const products = all<{
    id: number; kind: string; name: string; description: string | null; price_cents: number; credits: number | null;
    validity_weeks: number | null; eligibility: string; recurrence: string | null; active: number;
  }>(`SELECT * FROM products ORDER BY sort ASC, id ASC`);
  const rule = all<{ id: number; name: string; min_distinct_dates: number; max_distinct_dates: number; per_class_cents: number; active: number }>(
    `SELECT * FROM discount_rules WHERE kind = 'multi_date' LIMIT 1`
  )[0];
  const coupons = all<{ id: number; code: string; kind: string; value: number; min_total_cents: number; max_redemptions: number | null; times_redeemed: number; active: number }>(
    `SELECT * FROM coupons ORDER BY code`
  );
  const dropInProduct = products.find((p) => p.kind === "drop_in");
  const optionalProducts = products.filter((p) =>
    p.kind === "pass" ? settings.class_passes_enabled : p.kind === "membership" ? settings.memberships_enabled : false
  );

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Pricing</h1>
      {sp.saved ? <Alert kind="success">Saved.</Alert> : null}
      {sp.error ? <Alert kind="error">{sp.error}</Alert> : null}

      {/* Pricing simulator */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Pricing simulator</h2>
        <p className="mt-1 text-sm text-bark-500">Check how any basket will be priced before you change a rule. This uses the exact same engine as the checkout.</p>
        <div className="mt-4">
          <PricingSimulator />
        </div>
      </Card>

      {/* Drop-in default */}
      {dropInProduct && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-forest-900">Standard drop-in price</h2>
          <p className="mt-1 text-sm text-bark-500">Used for every class that doesn&apos;t have its own price override.</p>
          <form action={saveProductAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={dropInProduct.id} />
            <input type="hidden" name="kind" value="drop_in" />
            <Field label="Product name" name="name" defaultValue={dropInProduct.name} required />
            <Field label="Price (€)" name="price" defaultValue={(dropInProduct.price_cents / 100).toFixed(2)} required />
            <Field label="Description (shown on Prices page)" name="description" defaultValue={dropInProduct.description ?? ""} className="sm:col-span-2" />
            <label className="flex items-center gap-3 text-sm font-medium text-bark-700">
              <input type="checkbox" name="active" defaultChecked={!!dropInProduct.active} className="h-5 w-5 rounded accent-forest-800" /> Active
            </label>
            <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white sm:col-span-2">Save drop-in</button>
          </form>
        </Card>
      )}

      {!settings.multi_date_discount_enabled ? <Alert kind="info">Multi-date discounts are off for this site. Blocks and bundles are the combined-price offers.</Alert> : null}

      {/* Multi-date rule */}
      {settings.multi_date_discount_enabled ? (
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Multi-date discount rule</h2>
        <p className="mt-1 text-sm text-bark-500">Automatically applies when a customer books 2–4 different dates in one transaction. Discounts never stack - the customer always gets the single best option.</p>
        <form action={saveDiscountRuleAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={rule?.id ?? ""} />
          <Field label="Rule name (shown at checkout)" name="name" defaultValue={rule?.name ?? "Multi-date rate"} required />
          <Field label="Per-class price (€)" name="perClass" defaultValue={rule ? (rule.per_class_cents / 100).toFixed(2) : "11.00"} required />
          <Field label="Minimum different dates" name="minDates" type="number" defaultValue={String(rule?.min_distinct_dates ?? 2)} required />
          <Field label="Maximum different dates" name="maxDates" type="number" defaultValue={String(rule?.max_distinct_dates ?? 4)} required />
          <label className="flex items-center gap-3 text-sm font-medium text-bark-700">
            <input type="checkbox" name="active" defaultChecked={rule ? !!rule.active : true} className="h-5 w-5 rounded accent-forest-800" /> Rule active
          </label>
          <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white sm:col-span-2">Save rule</button>
        </form>
      </Card>
      ) : null}

      {!settings.class_passes_enabled ? <Alert kind="info">Class passes are off for this site. Existing customer credits remain usable.</Alert> : null}
      {!settings.memberships_enabled ? <Alert kind="info">Memberships are off for this site and cannot be purchased.</Alert> : null}

      {/* Passes & memberships */}
      {optionalProducts.length > 0 ? <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Passes &amp; memberships</h2>
        <div className="mt-4 space-y-3">
          {optionalProducts.map((p) => (
            <form key={p.id} action={saveProductAction} className="grid items-end gap-3 rounded-xl border border-oat-200 p-4 sm:grid-cols-6">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="kind" value={p.kind} />
              <input type="hidden" name="eligibility" value={p.eligibility} />
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-bark-500">Name</label>
                <input name="name" defaultValue={p.name} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-bark-500">Price €</label>
                <input name="price" defaultValue={(p.price_cents / 100).toFixed(2)} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
              </div>
              {p.kind === "pass" ? (
                <>
                  <div>
                    <label className="text-xs font-semibold text-bark-500">Credits</label>
                    <input name="credits" type="number" defaultValue={p.credits ?? ""} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-bark-500">Valid weeks</label>
                    <input name="validityWeeks" type="number" defaultValue={p.validity_weeks ?? ""} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-semibold text-bark-500">Renews</label>
                    <select name="recurrence" defaultValue={p.recurrence ?? "monthly"} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm">
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>
                  <div />
                </>
              )}
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-bark-500">Description</label>
                <input name="description" defaultValue={p.description ?? ""} className="w-full rounded-xl border border-oat-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex items-center gap-3 sm:col-span-4">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={!!p.active} className="h-5 w-5 rounded accent-forest-800" /> Active
                </label>
                <button type="submit" className="rounded-full bg-forest-800 px-5 py-2 text-sm font-semibold text-white">Save</button>
                <span className="text-xs text-bark-500">
                  {p.kind === "membership" ? "Membership - renewal consent is always requested at checkout" : `Pass${p.eligibility === "new_customer" ? " · new customers only" : ""}`}
                </span>
              </div>
            </form>
          ))}
        </div>

        <details className="mt-6 rounded-xl border border-dashed border-oat-300 p-4">
          <summary className="cursor-pointer font-semibold text-forest-900">+ Create a new pass or membership (e.g. a temporary offer)</summary>
          <form action={saveProductAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Name" name="name" required placeholder="e.g. Tuesday 5-class block" />
            <Field label="Price (€)" name="price" required placeholder="50.00" />
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
              Kind
              <select name="kind" className="rounded-xl border border-oat-300 px-4 py-3">
                <option value="pass">Class pass</option>
                <option value="membership">Membership</option>
              </select>
            </label>
            <Field label="Credits (passes)" name="credits" type="number" placeholder="5" />
            <Field label="Validity weeks (passes)" name="validityWeeks" type="number" placeholder="8" />
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
              Eligibility
              <select name="eligibility" className="rounded-xl border border-oat-300 px-4 py-3">
                <option value="all">Everyone</option>
                <option value="new_customer">New customers only</option>
              </select>
            </label>
            <Field label="Description" name="description" className="sm:col-span-2" placeholder="Shown on the prices page" />
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="active" defaultChecked className="h-5 w-5 rounded accent-forest-800" /> Active immediately
            </label>
            <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white sm:col-span-2">Create</button>
          </form>
        </details>
      </Card> : null}

      {/* Coupons */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Coupon codes</h2>
        <p className="mt-1 text-sm text-bark-500">Coupons apply to the drop-in price and never stack with other discounts - the engine picks whichever single option is best for the customer.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-oat-100 bg-oat-50 text-left text-xs uppercase tracking-wider text-bark-500">
                <th className="px-4 py-3 font-semibold">Code</th>
                <th className="px-4 py-3 font-semibold">Discount</th>
                <th className="px-4 py-3 font-semibold">Used</th>
                <th className="px-4 py-3 font-semibold">Active</th>
                <th className="px-4 py-3 font-semibold">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oat-100">
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                  <td className="px-4 py-3">{c.kind === "percent" ? `${c.value}% off` : `${fmtEuro(c.value)} off`}{c.min_total_cents > 0 ? ` (min ${fmtEuro(c.min_total_cents)})` : ""}</td>
                  <td className="px-4 py-3">{c.times_redeemed}{c.max_redemptions ? ` / ${c.max_redemptions}` : ""}</td>
                  <td className="px-4 py-3">{c.active ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">
                    <form action={saveCouponAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="code" value={c.code} />
                      <select name="kind" defaultValue={c.kind} className="rounded-lg border border-oat-300 px-2 py-1.5 text-xs">
                        <option value="percent">% off</option>
                        <option value="fixed">€ off</option>
                      </select>
                      <input name="value" defaultValue={String(c.value)} className="w-20 rounded-lg border border-oat-300 px-2 py-1.5 text-xs" />
                      <input name="maxRedemptions" type="number" defaultValue={c.max_redemptions ?? ""} placeholder="max uses" className="w-24 rounded-lg border border-oat-300 px-2 py-1.5 text-xs" />
                      <label className="inline-flex items-center gap-1 text-xs">
                        <input type="checkbox" name="active" defaultChecked={!!c.active} className="h-4 w-4 accent-forest-800" /> active
                      </label>
                      <button type="submit" className="rounded-lg bg-forest-800 px-3 py-1.5 text-xs font-semibold text-white">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
              {coupons.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-bark-500">No coupons yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <details className="mt-4 rounded-xl border border-dashed border-oat-300 p-4">
          <summary className="cursor-pointer font-semibold text-forest-900">+ New coupon</summary>
          <form action={saveCouponAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Code" name="code" required placeholder="SUMMER10" />
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-forest-900">
              Kind
              <select name="kind" className="rounded-xl border border-oat-300 px-4 py-3">
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed € off</option>
              </select>
            </label>
            <Field label="Value (percent 0–100, or € amount)" name="value" required />
            <Field label="Minimum basket (€, optional)" name="minTotal" />
            <Field label="Max redemptions (optional)" name="maxRedemptions" type="number" />
            <label className="flex items-center gap-3 self-end text-sm">
              <input type="checkbox" name="active" defaultChecked className="h-5 w-5 rounded accent-forest-800" /> Active
            </label>
            <button type="submit" className="min-h-[48px] rounded-full bg-forest-800 px-6 py-3 font-semibold text-white sm:col-span-2">Create coupon</button>
          </form>
        </details>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-forest-900">Tax</h2>
        <p className="mt-1 text-sm text-bark-500">
          Irish VAT treatment for yoga classes depends on Anne&apos;s registration status - this is a decision for her
          accountant, not software. Any note you write here shows on the prices page.
        </p>
        <p className="mt-2 text-xs text-bark-500">Current standard price: {dropInProduct ? fmtEuro(dropInProduct.price_cents) : "not set"} (edit it above) · currency {settings.currency} · all money stored as integer cents.</p>
      </Card>
    </div>
  );
}
