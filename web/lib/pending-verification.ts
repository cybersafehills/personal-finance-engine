export const PENDING_VERIFICATION_EMAIL_COOKIE =
  "ol_pending_verification_email";
export const PENDING_VERIFICATION_NEXT_COOKIE = "ol_pending_verification_next";
export const VERIFICATION_RESEND_AT_COOKIE = "ol_verification_resend_at";

export const PENDING_VERIFICATION_TTL_SECONDS = 60 * 60;
export const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;

export function pendingVerificationCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PENDING_VERIFICATION_TTL_SECONDS,
  };
}

export function encodePendingValue(value: string): string {
  return encodeURIComponent(value);
}

export function decodePendingValue(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// A signup confirmation carries no meaningful destination beyond "the page
// the visitor happened to be on" (almost always just "/", the
// internalRedirectPath default) - so a first-run, newly-confirmed user
// belongs in resumable profile setup, not wherever the signup form's own
// `next` param defaulted to. A caller-supplied deep link (an invite, e.g.)
// is followed as-is. Applied in app/auth/confirm/actions.ts once a token
// is actually verified, against whatever `next` was stashed in
// PENDING_VERIFICATION_NEXT_COOKIE at signup time.
export function signupConfirmationNext(nextPath: string): string {
  return nextPath && nextPath !== "/" ? nextPath : "/onboarding/profile";
}
