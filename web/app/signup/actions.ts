"use server";

import { cookies } from "next/headers";
import { supabaseSession } from "../../lib/supabase-session-server";
import { siteUrl } from "../../lib/site-url";
import { internalRedirectPath } from "../../lib/internal-redirect";
import {
  encodePendingValue,
  PENDING_VERIFICATION_EMAIL_COOKIE,
  PENDING_VERIFICATION_NEXT_COOKIE,
  pendingVerificationCookieOptions,
  VERIFICATION_RESEND_AT_COOKIE,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from "../../lib/pending-verification";
import {
  registrationErrorMessage,
  validateRegistration,
} from "../../lib/registration";

export type SignUpResult =
  | { ok: true; needsConfirmation: boolean }
  | { ok: false; error: string };

export async function signUp(
  email: string,
  password: string,
  next: string,
): Promise<SignUpResult> {
  const validation = validateRegistration(email, password);
  if (validation.error) {
    return { ok: false, error: validation.error };
  }

  const nextPath = internalRedirectPath(next);
  const supabase = await supabaseSession();

  // A fixed path, not a "verify and redirect" hop carrying `next` in its
  // query - /auth/confirm/actions.ts reads the actual destination back out
  // of PENDING_VERIFICATION_NEXT_COOKIE (set just below) once the token is
  // spent. That page also doesn't verify anything on its own GET load -
  // see its actions.ts comment for why (email security scanners prefetch
  // links, burning the one-time token before a real click ever happens).
  const emailRedirectTo = new URL("/auth/confirm", siteUrl());

  const { data, error } = await supabase.auth.signUp({
    email: validation.email,
    password,
    options: {
      emailRedirectTo: emailRedirectTo.toString(),
    },
  });

  if (error) {
    return { ok: false, error: registrationErrorMessage(error.message) };
  }

  if (!data.session) {
    const cookieStore = await cookies();
    const options = pendingVerificationCookieOptions();
    cookieStore.set(
      PENDING_VERIFICATION_EMAIL_COOKIE,
      encodePendingValue(validation.email),
      options,
    );
    cookieStore.set(
      PENDING_VERIFICATION_NEXT_COOKIE,
      encodePendingValue(nextPath),
      options,
    );
    cookieStore.set(
      VERIFICATION_RESEND_AT_COOKIE,
      String(Date.now() + VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000),
      options,
    );
  }

  // handle_new_user() (20260821000000_phase_b_identity_and_tenancy.sql)
  // provisions the profile/workspace/membership immediately on the
  // auth.users insert, regardless of confirmation state - "normal
  // financial use" is what email verification gates, not the
  // workspace's existence. If Supabase Auth already has a confirmed
  // session (email confirmations disabled in this environment),
  // data.session is set and the user is already signed in.
  return { ok: true, needsConfirmation: !data.session };
}
