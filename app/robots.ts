import type { MetadataRoute } from "next";

// An internal tool: nothing to index, on staging least of all (staging also
// sends X-Robots-Tag: noindex on every response, proxy.ts).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
