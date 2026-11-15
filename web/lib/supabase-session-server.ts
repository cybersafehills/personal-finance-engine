import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { mobileAccessToken } from "./mobile-session-context";

// The session-authenticated server client - built from the anon key plus
// the current request's session cookie, NOT the service-role key. Every
// query issued through this client is subject to RLS as that specific
// user, which is the actual security boundary Phase B introduces. Use
// this for all ordinary user-facing reads/writes; reserve
// lib/supabase-server.ts's service-role client for the ingestion path and
// genuinely privileged server operations (e.g. the new-user backfill
// tooling), never for rendering a page on a user's behalf.
type CookieJar = Awaited<ReturnType<typeof cookies>>;

function cookieClient(cookieStore: CookieJar) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component render, where cookies can't
            // be written - middleware's own session refresh (below)
            // covers this; safe to ignore here.
          }
        },
      },
    },
  );
}

export async function supabaseSession() {
  // Mobile API request (bearer token already validated by the route): same
  // anon key, same RLS, but the identity comes from the Authorization header.
  const bearer = mobileAccessToken();
  if (bearer) {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      },
    ) as unknown as ReturnType<typeof cookieClient>;
  }

  return cookieClient(await cookies());
}
