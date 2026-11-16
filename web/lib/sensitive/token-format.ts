// Pure helpers for showing a utility token. No I/O.

/** 1234-5678-9012-3456-7890 from 20 digits (groups of 4; shorter/longer tokens grouped the same way). */
export function formatUtilityToken(digits: string): string {
  return digits.replace(/[^0-9]/g, "").replace(/(\d{4})(?=\d)/g, "$1-");
}

/** Capture (Edge) and reveal (web/mobile) share one opt-in switch. */
export function isUtilityTokenFeatureEnabled(
  env: { UTILITY_TOKEN_CAPTURE_ENABLED?: string },
): boolean {
  return env.UTILITY_TOKEN_CAPTURE_ENABLED === "true";
}

/** A safe sentence for each failure; never raw database text. */
export function friendlyRevealError(raw: string | null | undefined): string {
  const s = raw ?? "";
  if (/rate_limited/.test(s)) {
    return "You've viewed a lot of tokens in the last hour. Please try again later.";
  }
  if (/sensitive_detail_not_found|not_authenticated/.test(s)) {
    return "This token isn't available to you.";
  }
  if (/decrypt_failed/.test(s)) {
    return "This token couldn't be read. Please contact support.";
  }
  return "Something went wrong. Please try again.";
}

/** kWh x 1000 (an integer) -> "11.9": trailing zeros trimmed, no floating-point surprises for display. */
export function kwhText(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const frac = String(Math.abs(milli) % 1000).padStart(3, "0").replace(
    /0+$/,
    "",
  );
  return frac ? `${whole}.${frac}` : String(whole);
}
