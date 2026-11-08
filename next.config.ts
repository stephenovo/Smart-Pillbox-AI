import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1", "10.89.68.228"],
};

export default nextConfig;

if (
  process.env.PILLBOX_MODE === "pilot" &&
  process.env.NODE_ENV === "development"
) {
  void initOpenNextCloudflareForDev({
    configPath:
      process.env.PILOT_WRANGLER_CONFIG || "wrangler.pilot.local.jsonc",
  });
}
