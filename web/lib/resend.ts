import "server-only";
import { Resend } from "resend";

// Server-only Resend client. RESEND_API_KEY is deliberately not prefixed
// with NEXT_PUBLIC_, so Next.js never inlines it into any browser bundle
// - same guard as lib/supabase-server.ts's service-role key. Do not
// import this module from a "use client" file.
//
// Unlike supabase-server.ts, this deliberately does NOT throw when the
// key is missing: lib/emails.ts (and therefore this module) is imported
// from the login Server Action, which runs on every sign-in - a
// missing/misconfigured Resend key must degrade to "no email sent" (see
// emails.ts's own try/catch around every send), never break sign-in
// itself. The Resend SDK's constructor throws synchronously on an empty
// key, so the client is built lazily and only when a key is actually
// present, instead of at module load.

let cached: Resend | null | undefined;

export function getResendClient(): Resend | null {
  if (cached === undefined) {
    const apiKey = process.env.RESEND_API_KEY;
    cached = apiKey ? new Resend(apiKey) : null;
  }
  return cached;
}
