import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained Node server (Dockerfile): no Vercel-specific features.
  output: "standalone",
  poweredByHeader: false,
  // Files read from disk at runtime must be in the standalone bundle: pages
  // rendered on request read their legal texts from legal/*.md.
  outputFileTracingIncludes: {
    "/**": ["./legal/*.md"],
  },
  experimental: {
    serverActions: {
      // Hand-in photos are uploaded straight to Storage; actions only carry form data.
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
        ],
      },
    ];
  },
};

export default nextConfig;
