import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Gives `getCloudflareContext()` access to Miniflare-backed D1/R2 bindings during `next dev`.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // The Workers runtime serves images straight from R2 / cdn-cgi; the Next optimizer
  // is unavailable on OpenNext Cloudflare.
  images: { unoptimized: true },
};

export default nextConfig;
