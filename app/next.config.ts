import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["googleapis"],
  // Which Vercel environment this was built for, baked in at build time — so
  // the database choice in lib/db.ts can't be fooled by a runtime that
  // doesn't expose VERCEL_ENV. Not a secret.
  env: { CSTL_BUILD_ENV: process.env.VERCEL ? (process.env.VERCEL_ENV ?? "preview") : "local" },
};

export default nextConfig;
