// Privacy-conscious product-event tracking for the directory surface
// (master prompt section 17). This codebase has NO analytics provider
// wired in - `service_recent_usage` (schema-constrained to hold no PII)
// is the durable usage store. This module is the single place a provider
// would be attached, and it hard-strips anything that looks like personal
// or transaction data BEFORE it could ever leave the process, so the
// redaction is unit-testable regardless of whether a sink is connected.

export type DirectoryEventName =
  | "directory_search"
  | "network_viewed"
  | "route_viewed"
  | "route_finder_no_result"
  | "code_copied"
  | "dialer_attempted"
  | "favourite_saved"
  | "suggestion_submitted"
  | "problem_reported";

// Keys that must never reach analytics, and value shapes that look like
// raw identifiers (phone numbers, account/meter/merchant numbers, a
// filled USSD string). Matched case-insensitively on the key; values are
// additionally scrubbed if they look like a bare 6+ digit run or contain
// a USSD control char.
const FORBIDDEN_KEY = /phone|msisdn|account|meter|merchant|billing|amount|reference|pin|otp|ussd|national_id|nid|email/i;
const LOOKS_LIKE_IDENTIFIER = /(\d[\s-]?){6,}|[*#]/;

export function sanitizeEventProps(
  props: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (typeof value === "boolean" || typeof value === "number") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (LOOKS_LIKE_IDENTIFIER.test(value)) continue;
      // Cap length so a free-text blob can't be exfiltrated as a "prop".
      out[key] = value.slice(0, 64);
    }
  }
  return out;
}

export function trackDirectoryEvent(
  name: DirectoryEventName,
  props?: Record<string, unknown>,
): void {
  const safe = sanitizeEventProps(props);
  // No provider connected. When one is added, forward `{ name, ...safe }`
  // here - never the raw `props`.
  if (process.env.NODE_ENV !== "production") {
    console.debug("[directory-event]", name, safe);
  }
}
