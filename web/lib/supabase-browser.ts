import { createBrowserClient } from "@supabase/ssr";

// The anon key is designed to be public (it is the whole point of the
// publishable/anon key pair) - what actually protects data is RLS,
// enforced server-side by Postgres itself regardless of what this client
// is told. This is the ONLY Supabase client browser code may ever hold;
// SUPABASE_SERVICE_ROLE_KEY never reaches this file or anything it imports.
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
