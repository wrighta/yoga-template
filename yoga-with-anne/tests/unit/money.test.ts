import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtEuro, parseEuroInputToCents, nonNegativeCents } from "@/lib/money";

test("euro formatting (en-IE)", () => {
  assert.equal(fmtEuro(1200), "€12.00");
  assert.equal(fmtEuro(0), "€0.00");
  assert.equal(fmtEuro(9550), "€95.50");
});

test("price input parsing is forgiving but exact", () => {
  assert.equal(parseEuroInputToCents("12"), 1200);
  assert.equal(parseEuroInputToCents("12.5"), 1250);
  assert.equal(parseEuroInputToCents("€95.50"), 9550);
  assert.equal(parseEuroInputToCents(" 7,50 "), 750);
  assert.equal(parseEuroInputToCents(""), null);
  assert.equal(parseEuroInputToCents("abc"), null);
  assert.equal(parseEuroInputToCents("-5"), null);
});

test("totals never go negative", () => {
  assert.equal(nonNegativeCents(-1), 0);
  assert.equal(nonNegativeCents(100.4), 100);
});
