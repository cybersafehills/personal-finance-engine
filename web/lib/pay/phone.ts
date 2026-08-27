// Rwandan mobile-number handling for Assisted Quick Pay.
//
// Canonical normalized form: `2507XXXXXXXX` (12 digits, no `+`) - the
// same shape the Phase N `*_msisdn` CHECK constraints enforce. Display
// form preserves whatever the user typed. Dependency-free so it runs in
// a Deno unit test and a React client component alike.

export type NormalizedMsisdn = {
  /** `2507XXXXXXXX`, or null if the input isn't a recognisable RW mobile number. */
  normalized: string | null;
  /** The user's input, trimmed - never discarded. */
  display: string;
};

const RW_MOBILE_RE = /^2507[2389]\d{7}$/;

export function normalizeRwandaMsisdn(input: string): NormalizedMsisdn {
  const display = input.trim();
  const digits = display.replace(/[^\d]/g, "");

  let candidate: string | null = null;
  if (/^250\d{9}$/.test(digits)) {
    candidate = digits;
  } else if (/^0\d{9}$/.test(digits)) {
    candidate = "250" + digits.slice(1);
  } else if (/^7\d{8}$/.test(digits)) {
    candidate = "250" + digits;
  }

  return {
    normalized: candidate && RW_MOBILE_RE.test(candidate) ? candidate : null,
    display,
  };
}

/** `•••• ••• 4567` - keeps only the last 4 digits. Empty string for a null/blank input. */
export function maskMsisdn(normalized: string | null | undefined): string {
  if (!normalized) return "";
  const last4 = normalized.slice(-4);
  return `•••• ••• ${last4}`;
}

/**
 * Best-effort network guess from the `07X` prefix (MTN: 078/079,
 * Airtel: 072/073). Null when it can't tell. This is a hint for the
 * review screen, never an authorization input.
 */
export function guessProvider(
  normalized: string | null | undefined,
): "mtn" | "airtel" | null {
  if (!normalized || !RW_MOBILE_RE.test(normalized)) return null;
  const prefix = normalized.slice(3, 5); // the "7X"
  if (prefix === "78" || prefix === "79") return "mtn";
  if (prefix === "72" || prefix === "73") return "airtel";
  return null;
}

/** `078 123 4567` from a normalized `2507XXXXXXXX` - for display only. */
export function formatLocalMsisdn(normalized: string | null | undefined): string {
  if (!normalized || !RW_MOBILE_RE.test(normalized)) return normalized ?? "";
  const local = "0" + normalized.slice(3); // 07XXXXXXXX
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}
