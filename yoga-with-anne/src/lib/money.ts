/** All money is integer cents (EUR). Never floats. */

export function fmtEuro(cents: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function nonNegativeCents(n: number): number {
  return Math.max(0, Math.round(n));
}

export function parseEuroInputToCents(input: string): number | null {
  const cleaned = input.replace(/[€\s,]/g, (m) => (m === "," ? "." : ""));
  const v = Number.parseFloat(cleaned);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}
