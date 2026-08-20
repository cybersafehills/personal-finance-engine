import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client. The `server-only` import above makes any
// accidental import of this file from client-side code fail at build time
// (Next.js's own guard), and SUPABASE_SERVICE_ROLE_KEY is deliberately not
// prefixed with NEXT_PUBLIC_, so Next.js never inlines it into any
// browser bundle. Do not import this module from a "use client" file or
// pass its client instance to one.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-only, see .env.local.example).",
  );
}

export function supabaseServer() {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
