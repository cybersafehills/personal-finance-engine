import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { internalRedirectPath } from "../../../lib/internal-redirect";
import { siteUrl } from "../../../lib/site-url";

// Exchanges a Supabase Auth confirmation/recovery code for a real session.
// Used by both the signup-confirmation email link and the password-reset
// email link (which additionally carries a `next` param pointing at
// /auth/reset-password/confirm).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
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
  const destination = new URL(next, siteUrl());
  let response = NextResponse.redirect(destination);

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value } of cookiesToSet) {
              request.cookies.set(name, value);
            }
            response = NextResponse.redirect(destination);
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      },
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return response;
    }
  }

  return NextResponse.redirect(new URL("/login", siteUrl()));
}
