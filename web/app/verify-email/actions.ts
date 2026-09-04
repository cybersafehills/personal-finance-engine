"use server";

import { cookies } from "next/headers";
import {
  decodePendingValue,
  PENDING_VERIFICATION_EMAIL_COOKIE,
  pendingVerificationCookieOptions,
  VERIFICATION_RESEND_AT_COOKIE,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from "../../lib/pending-verification";
import { registrationErrorMessage } from "../../lib/registration";
import { siteUrl } from "../../lib/site-url";
import { supabaseSession } from "../../lib/supabase-session-server";

export type ResendVerificationResult =
  | { ok: true; resendAvailableAt: number }
  | { ok: false; error: string; resendAvailableAt?: number };

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
