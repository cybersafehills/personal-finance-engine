import { NextResponse } from "next/server";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { internalRedirectPath } from "../../../lib/internal-redirect";

// Exchanges a Supabase Auth confirmation/recovery code for a real session.
// Used by both the signup-confirmation email link and the password-reset
// email link (which additionally carries a `next` param pointing at
// /auth/reset-password/confirm).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");

  // A signup-confirmation link carries no `next` (or just "/"); send
  // those first-run users to the onboarding checklist. Links that DO
  // carry a `next` - password reset (/auth/reset-password/confirm), an
  // invite (/invite/<token>) - are followed after same-origin validation.
  // /get-started
  // itself redirects to "/" when the checklist flag is off, so this is
  // always safe.
  const next = internalRedirectPath(
    rawNext && rawNext !== "/" ? rawNext : "/get-started",
    "/get-started",
  );

  if (code) {
    const supabase = await supabaseSession();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
