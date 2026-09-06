"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  decodePendingValue,
  PENDING_VERIFICATION_EMAIL_COOKIE,
  PENDING_VERIFICATION_NEXT_COOKIE,
  pendingVerificationCookieOptions,
  signupConfirmationNext,
  VERIFICATION_RESEND_AT_COOKIE,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from "../../lib/pending-verification";
import { internalRedirectPath } from "../../lib/internal-redirect";
import { registrationErrorMessage } from "../../lib/registration";
import { siteUrl } from "../../lib/site-url";
import { supabaseSession } from "../../lib/supabase-session-server";

export type ResendVerificationResult =
  | { ok: true; resendAvailableAt: number }
  | { ok: false; error: string; resendAvailableAt?: number };

export type VerifyCodeResult = { ok: false; error: string };

// Inline alternative to the emailed link: the same "Confirm signup" email
// also carries a 6-digit code ({{ .Token }} in the Supabase template).
// Verifying it here lands the user in exactly the same place the link
// would (PENDING_VERIFICATION_NEXT_COOKIE, else /onboarding/profile).
// Returns only on failure - success redirects.
export async function verifySignupCode(
  rawCode: string,
): Promise<VerifyCodeResult> {
  const code = rawCode.replace(/\D/g, "").trim();
  if (code.length < 6) {
    return { ok: false, error: "Enter the 6-digit code from the email." };
  }

  const cookieStore = await cookies();
  const email = decodePendingValue(
    cookieStore.get(PENDING_VERIFICATION_EMAIL_COOKIE)?.value,
  );
  if (!email) {
    return {
      ok: false,
      error:
        "We lost track of which address you're verifying. Start again from sign up.",
    };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase.auth.verifyOtp({
    type: "email",
    email,
    token: code,
  });

  if (error) {
    return {
      ok: false,
      error: /expired/i.test(error.message)
        ? "That code has expired. Send a fresh one below."
        : "That code didn't match. Check the email and try again.",
    };
  }

  const storedNext = decodePendingValue(
    cookieStore.get(PENDING_VERIFICATION_NEXT_COOKIE)?.value,
  );
  const next = internalRedirectPath(
    signupConfirmationNext(storedNext ?? "/"),
    "/onboarding/profile",
  );

  cookieStore.delete(PENDING_VERIFICATION_EMAIL_COOKIE);
  cookieStore.delete(PENDING_VERIFICATION_NEXT_COOKIE);
  cookieStore.delete(VERIFICATION_RESEND_AT_COOKIE);

  redirect(next);
}

export async function resendVerificationEmail(): Promise<
  ResendVerificationResult
> {
  const cookieStore = await cookies();
  const email = decodePendingValue(
    cookieStore.get(PENDING_VERIFICATION_EMAIL_COOKIE)?.value,
  );
  const resendAvailableAt = Number(
    cookieStore.get(VERIFICATION_RESEND_AT_COOKIE)?.value ?? 0,
  );

  if (!email) {
    return {
      ok: false,
      error:
        "Start again with your email address so we know where to send the link.",
    };
  }

  if (Number.isFinite(resendAvailableAt) && resendAvailableAt > Date.now()) {
    return {
      ok: false,
      error: "Please wait before requesting another email.",
      resendAvailableAt,
    };
  }

  // Fixed path - PENDING_VERIFICATION_NEXT_COOKIE (untouched here, still
  // set from the original signup) is what actually determines where
  // /auth/confirm sends the visitor once the token is spent.
  const emailRedirectTo = new URL("/auth/confirm", siteUrl());

  const supabase = await supabaseSession();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: emailRedirectTo.toString() },
  });

  if (error) {
    return { ok: false, error: registrationErrorMessage(error.message) };
  }

  const nextResendAt = Date.now() + VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
  cookieStore.set(
    VERIFICATION_RESEND_AT_COOKIE,
    String(nextResendAt),
    pendingVerificationCookieOptions(),
  );
  return { ok: true, resendAvailableAt: nextResendAt };
}
