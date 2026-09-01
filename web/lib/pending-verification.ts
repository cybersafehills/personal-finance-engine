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
