import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { internalRedirectPath } from "../../../lib/internal-redirect";
import { verificationFailureStatus } from "../../../lib/auth-callback";
import {
  PENDING_VERIFICATION_EMAIL_COOKIE,
  PENDING_VERIFICATION_NEXT_COOKIE,
  VERIFICATION_RESEND_AT_COOKIE,
} from "../../../lib/pending-verification";
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
  // those first-run users to resumable profile setup. Links that DO
  // carry a `next` - password reset (/auth/reset-password/confirm), an
  // invite (/invite/<token>) - are followed after same-origin validation.
  const next = internalRedirectPath(
    rawNext && rawNext !== "/" ? rawNext : "/onboarding/profile",
    "/onboarding/profile",
  );
  const destination = new URL(next, siteUrl());
  const isPasswordRecovery = next.startsWith("/auth/reset-password");
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
      response.cookies.delete(PENDING_VERIFICATION_EMAIL_COOKIE);
      response.cookies.delete(PENDING_VERIFICATION_NEXT_COOKIE);
      response.cookies.delete(VERIFICATION_RESEND_AT_COOKIE);
      return response;
    }

    const status = verificationFailureStatus(error);
    const failurePath = isPasswordRecovery
      ? `/auth/reset-password?status=${status}`
      : `/verify-email?status=${status}`;
    return NextResponse.redirect(new URL(failurePath, siteUrl()));
  }

  const failurePath = isPasswordRecovery
    ? "/auth/reset-password?status=missing"
    : "/verify-email?status=missing";
  return NextResponse.redirect(new URL(failurePath, siteUrl()));
}
