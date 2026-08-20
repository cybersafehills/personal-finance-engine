import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // lib/queries.ts imports the Kigali day-boundary helper directly from
  // supabase/functions/_shared/kigali-time.ts (one level up, outside this
  // Next.js project) rather than duplicating that logic - Turbopack needs
  // an explicit root to resolve outside its default project boundary.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
