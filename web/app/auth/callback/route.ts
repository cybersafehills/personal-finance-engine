import { NextResponse } from "next/server";
import { supabaseSession } from "../../../lib/supabase-session-server";

// Exchanges a Supabase Auth confirmation/recovery code for a real session.
// Used by both the signup-confirmation email link and the password-reset
// email link (which additionally carries a `next` param pointing at
// /auth/reset-password/confirm).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await supabaseSession();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
