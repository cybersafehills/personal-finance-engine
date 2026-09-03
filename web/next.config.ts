import type { NextConfig } from "next";

// `api.oneledger.me` is added to this Vercel project (Domains → Production).
// It serves the same Next app as the main domains, so scope the API proxy to
// that host only: a request to https://api.oneledger.me/v1/<path> is proxied
// (not redirected) to the Supabase Edge Function gateway
// <SUPABASE_URL>/functions/v1/<path>. This is the stable address paired
// devices are handed as `capture_url` (ONELEDGER_CAPTURE_BASE_URL =
// https://api.oneledger.me/v1); the Supabase project ref can change behind it
// without any device reconfiguration. See docs/device-pairing.md and ADR 0008.
//
// The Edge Functions run `verify_jwt = false`, so the proxy just forwards the
// device's own headers (x-device-key / x-processor-secret) and body - no
// Supabase auth header is added or required.
//
// If neither env var is set at build time the rewrite is simply omitted
// (the app still builds); `api.oneledger.me/v1/*` would then 404 until a
// build runs with the env present.
const SUPABASE_ORIGIN = (
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
).replace(/\/+$/, "");

const API_HOST = "api.oneledger.me";

const nextConfig: NextConfig = {
  async rewrites() {
    if (!SUPABASE_ORIGIN) return [];
    return [
      {
        source: "/v1/:path*",
        has: [{ type: "host", value: API_HOST }],
        destination: `${SUPABASE_ORIGIN}/functions/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
