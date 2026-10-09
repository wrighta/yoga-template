import type { NextConfig } from "next";

// Pragmatic CSP: Next.js injects inline bootstrap scripts/styles, so 'unsafe-inline'
// is required for those; no third-party scripts are loaded anywhere.
// In dev, React Refresh needs 'unsafe-eval'; keep it simple and skip CSP there.
const cspHeader = {
  key: "Content-Security-Policy",
  value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' https://www.openstreetmap.org",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; "),
};

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Harmless over plain HTTP; enforced by browsers only on HTTPS origins.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // CSP is production-only: dev-mode React Refresh needs 'unsafe-eval'.
  ...(process.env.NODE_ENV === "production" ? [cspHeader] : []),
];

const nextConfig: NextConfig = {
  // The E2E suite's dev server uses a separate dist dir so it can never
  // corrupt production builds (see playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Any DB access happens at request time; pages that need fresh data opt out of caching.
  poweredByHeader: false,
  // Photo uploads travel through Server Actions: the transport limit must sit
  // ABOVE the per-image cap of 4 MB enforced in src/lib/media.ts (the client
  // pre-checks sizes, this is the backstop).
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  // Keep the dev overlay out of the DOM so accessibility scans see exactly what users see.
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
