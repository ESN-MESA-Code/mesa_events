import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained Node server (Dockerfile): no Vercel-specific features.
  output: "standalone",
  // A second build next to the usual one (the staging-mode E2E: .next-staging).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The app environment (lib/staging.ts) is always a build-time constant –
  // also when unset – so production builds drop the staging-only code.
  env: {
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV || (process.env.NODE_ENV === "production" ? "production" : "development"),
  },
  poweredByHeader: false,
  // Files read from disk at runtime must be in the standalone bundle: pages
  // rendered on request read their legal texts from legal/*.md, the ESN
  // Activities page the browser script from tools/esn-activities/.
  outputFileTracingIncludes: {
    "/**": ["./legal/*.md", "./tools/esn-activities/*.js"],
  },
  experimental: {
    serverActions: {
      // Actions only carry form data (photos go straight to Drive).
      bodySizeLimit: "1mb",
    },
  },
  // Static files skip proxy.ts; they get the basic headers here.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          // Staging builds (docs/STAGING.md): never indexed.
          ...(process.env.NEXT_PUBLIC_APP_ENV === "staging" ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
