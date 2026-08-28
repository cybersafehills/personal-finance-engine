// Shared masking for identifiers surfaced on the review screen - enough
// to recognise the recipient, never the whole value (§6). Pure.

/** Keep the last `keep` chars, replace the rest with bullets. A value at
 *  or below `keep` chars is returned as-is (nothing to hide). */
export function maskTrailing(value: string, keep = 4): string {
  const v = value.trim();
  if (v.length <= keep) return v;
  return "•••• " + v.slice(-keep);
}

/** Digit-run mask for a phone-like value: `•••• ••• 4567`. */
export function maskDigits(value: string, keep = 4): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= keep) return digits;
  return `•••• ••• ${digits.slice(-keep)}`;
}
