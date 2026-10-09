import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "@/lib/stripe";

const SECRET = "whsec_test_secret";
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });

function sign(payload: string, secret: string, t: number): string {
  return createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
}

test("a valid Stripe signature verifies", () => {
  const t = Math.floor(Date.now() / 1000);
  const header = `t=${t},v1=${sign(PAYLOAD, SECRET, t)}`;
  assert.equal(verifyStripeSignature(PAYLOAD, header, SECRET), true);
});

test("a tampered payload fails verification", () => {
  const t = Math.floor(Date.now() / 1000);
  const header = `t=${t},v1=${sign(PAYLOAD + "x", SECRET, t)}`;
  assert.equal(verifyStripeSignature(PAYLOAD, header, SECRET), false);
});

test("a replayed signature older than the tolerance is rejected", () => {
  const t = Math.floor(Date.now() / 1000) - 3600; // 1h old
  const header = `t=${t},v1=${sign(PAYLOAD, SECRET, t)}`;
  assert.equal(verifyStripeSignature(PAYLOAD, header, SECRET), false);
});

test("a wrong secret fails", () => {
  const t = Math.floor(Date.now() / 1000);
  const header = `t=${t},v1=${sign(PAYLOAD, "whsec_other", t)}`;
  assert.equal(verifyStripeSignature(PAYLOAD, header, SECRET), false);
});

test("missing or malformed headers fail safely", () => {
  const t = Math.floor(Date.now() / 1000);
  assert.equal(verifyStripeSignature(PAYLOAD, null, SECRET), false);
  assert.equal(verifyStripeSignature(PAYLOAD, "nonsense", SECRET), false);
  assert.equal(verifyStripeSignature(PAYLOAD, `t=${t}`, SECRET), false);
});
