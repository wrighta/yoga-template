"use client";

import { useState } from "react";
import { fmtEuro } from "@/lib/money";

type SimResult = {
  chosen: { kind: string; label: string; explanation: string };
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  alternatives: { label: string; totalCents: number; savedCents: number }[];
};

export function PricingSimulator() {
  const [count, setCount] = useState(2);
  const [coupon, setCoupon] = useState("");
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seats: count, coupon: coupon || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Simulator failed");
      setResult(json as SimResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulator failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold text-forest-900">
          Classes in the basket
          <input
            id="pricing-sim-seats"
            type="number"
            min={1}
            max={10}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            className="ml-2 w-20 rounded-xl border border-oat-300 px-3 py-2"
          />
        </label>
        <label className="text-sm font-semibold text-forest-900">
          Coupon (optional)
          <input
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
            placeholder="CODE"
            className="ml-2 w-32 rounded-xl border border-oat-300 px-3 py-2 uppercase"
          />
        </label>
        <button type="button" onClick={run} disabled={loading} className="min-h-[44px] rounded-full bg-forest-800 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {loading ? "Simulating…" : "Simulate price"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm font-medium text-clay-700" role="alert">{error}</p>}
      {result && (
        <div className="mt-4 rounded-xl bg-oat-50 p-4 text-sm">
          <p className="font-semibold text-forest-900">
            Total: {fmtEuro(result.totalCents)}
            {result.discountCents > 0 ? ` - saved ${fmtEuro(result.discountCents)}` : ""}
          </p>
          <p className="mt-1 text-bark-700">
            <strong>{result.chosen.label}</strong> - {result.chosen.explanation}
          </p>
          {result.alternatives.filter((a) => a.savedCents > 0).length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-bark-500">
              {result.alternatives.filter((a) => a.savedCents > 0).map((a) => (
                <li key={a.label}>{a.label}: {fmtEuro(a.totalCents)} (saves {fmtEuro(a.savedCents)})</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
