/**
 * Runtime/deployment safety helpers.
 * The simulated payment page and other dev conveniences must FAIL CLOSED:
 * they may never activate in a production deployment, even if an env var is
 * forgotten or misconfigured.
 */

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Test payments are only ever allowed in a non-production runtime
 * AND when not explicitly disabled. In production this is always false.
 */
export function devPaymentsEnabled(): boolean {
  return !isProduction() && process.env.DEV_PAYMENTS !== "0";
}

/** Constant-time comparison for shared secrets (cron tokens etc.). */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Only allow same-site relative redirect targets ("/<path>"), never "//host" or schemes. */
export function safeRedirectPath(value: string | undefined | null, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
