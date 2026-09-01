export type VerificationFailureStatus = "expired" | "invalid" | "missing";

export function verificationFailureStatus(
  error: { message?: string; code?: string } | null,
): VerificationFailureStatus {
  if (!error) return "missing";

  const detail = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (detail.includes("expired") || detail.includes("otp_expired")) {
    return "expired";
  }

  return "invalid";
}
