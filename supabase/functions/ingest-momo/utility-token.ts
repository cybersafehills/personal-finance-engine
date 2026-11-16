// Utility-token handling for MTN MoMo payment SMS (e.g. prepaid electricity
// "Cash Power": "... with token 1234-5678-9012-3456-7890 ...").
//
// WHY THIS EXISTS: the generic merchant-payment pattern captures everything
// between "to" and "was completed at" as the merchant label. For a message that
// carries a token, that label would contain the TOKEN - which would then flow
// into transactions.counterparty_name, metadata.original_counterparty_name,
// merchant-rule matching, lists, PDF statements and emails. A token is a
// bearer value (whoever has it can redeem the electricity), so it must never
// be part of any display field. This module (a) pulls the token and kWh out,
// (b) strips the token from the label, so nothing downstream can leak it.
//
// IMPORTANT - FORMAT ASSUMPTIONS: no real Cash Power SMS was available when this
// was written. The token shape (16-24 digits, optionally in groups separated by
// "-" or spaces, introduced by the word "token") is taken from the repo's own
// airtime comment ("...with token ...") and general knowledge, and is covered
// only by SYNTHETIC fixtures. Extraction is deliberately strict: when nothing
// matches it returns nulls - it never guesses and never invents a value. The
// label redaction is deliberately broader than the extraction (any "with token
// ..." tail is removed) so that an unrecognised token shape still cannot leak
// into a display field. Validate against real anonymised messages before
// relying on extraction.

export type UtilityTokenDetails = {
  /** Digits only (16-24), or null when no recognisable token is present. */
  token: string | null;
  /** Energy purchased, normalised to a dot-decimal string ("12.5"), or null. */
  kwh: string | null;
  /** True when the message mentions a token at all (even an unparseable one). */
  tokenMentioned: boolean;
};

const TOKEN_INTRO = /\btoken\b[:\s]*/i;
const TOKEN_VALUE =
  /\btoken\b[:\s]*((?:\d{4}[-\s]){3,5}\d{1,4}|\d{16,24})(?!\d)/i;
const KWH = /(\d+(?:[.,]\d{1,3})?)\s*kwh\b/i;

export function extractUtilityTokenDetails(
  message: string,
): UtilityTokenDetails {
  const tokenMentioned = TOKEN_INTRO.test(message);
  let token: string | null = null;
  const m = TOKEN_VALUE.exec(message);
  if (m) {
    const digits = m[1].replace(/[^0-9]/g, "");
    if (digits.length >= 16 && digits.length <= 24) token = digits;
  }
  const k = KWH.exec(message);
  const kwh = k ? k[1].replace(",", ".") : null;
  return { token, kwh, tokenMentioned };
}

/**
 * Remove any token tail from a merchant label:
 *   "EUCL with token 1234-5678-9012-3456-7890" -> "EUCL"
 * Broad on purpose (see header): everything from "with token" / "token:" on is
 * dropped, plus any stray run of 12+ digits that looks like a token.
 */
export function redactTokenFromLabel(label: string): string {
  return label
    .replace(/\s*\b(?:with\s+)?token\b.*$/i, "")
    .replace(/\b\d{4}(?:[-\s]\d{4}){2,}(?:[-\s]\d{1,4})?\b/g, "")
    .replace(/\b\d{12,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
