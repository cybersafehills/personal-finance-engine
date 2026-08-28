import type { NormalizedScan } from "./normalize";
import type { PayloadClass, RejectionReason } from "./types";

// Stage 2 - classification. Decide which parser owns this payload. This
// is a cheap structural sort, NOT validation: a string classified
// "oneledger_payment" can still be rejected by the schema check, and one
// classified "provider_link" can still fail the allowlist.
//
// A "suspicious" outcome short-circuits the pipeline - the payload is
// actively dangerous to even hand onward (executable URI schemes, an
// embedded-credentials URL), so it is never parsed further.

export type Classification =
  | { kind: Exclude<PayloadClass, "suspicious"> }
  | { kind: "suspicious"; reason: RejectionReason };

// Executable / local-resource URI schemes. A QR that decodes to one of
// these is hostile by construction (§5.3).
const UNSAFE_SCHEMES = [
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
  "about:",
  "chrome:",
  "content:",
  "intent:",
];

// A bare USSD string: begins * or #, then digits / * / nested #, ends #.
// Covers *182#, *182*1*1#, *182*8*1*250781234567*5000#, #123#.
const BARE_USSD_RE = /^[*#][\d*#]{1,60}#$/;

export function classify(n: NormalizedScan): Classification {
  const { raw, lower } = n;

  if (UNSAFE_SCHEMES.some((s) => lower.startsWith(s))) {
    return { kind: "suspicious", reason: "unsafe_scheme" };
  }

  // An http(s) URL carrying credentials (user:pass@host) is a phishing
  // tell - reject before it can be classified as a provider link.
  if (
    (lower.startsWith("http://") || lower.startsWith("https://")) &&
    /^https?:\/\/[^/@\s]*@/i.test(raw)
  ) {
    return { kind: "suspicious", reason: "embedded_credentials" };
  }

  if (lower.startsWith("tel:") || BARE_USSD_RE.test(raw)) {
    return { kind: "verified_ussd" };
  }

  if (lower.startsWith("oneledger:") || (raw.startsWith("{") && raw.endsWith("}"))) {
    return { kind: "oneledger_payment" };
  }

  // EMV merchant-presented QR: TLV that opens with the Payload Format
  // Indicator, tag "00", length "02", value "01" -> literally "000201".
  if (raw.startsWith("000201")) {
    return { kind: "emv_merchant" };
  }

  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    // The allowlist decides allowlisted-provider vs rejected.
    return { kind: "provider_link" };
  }

  // Any other `scheme:` we don't handle.
  if (/^[a-z][a-z0-9+.-]*:/.test(lower)) {
    return { kind: "unsupported" };
  }

  return { kind: "unsupported" };
}

/** For classify() results that map straight to a rejection without a
 *  dedicated parser. */
export function rejectionForUnsupported(n: NormalizedScan): RejectionReason {
  return /^[a-z][a-z0-9+.-]*:/.test(n.lower) ? "unknown_scheme" : "not_recognised";
}
