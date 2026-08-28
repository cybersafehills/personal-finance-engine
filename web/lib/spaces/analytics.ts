// Privacy-conscious product-event tracking for the OneLedger Spaces
// surface (master prompt "Analytics events"). Like lib/pay/scan-analytics.ts
// and lib/directory/analytics.ts, this codebase has NO analytics provider
// wired in - this module is the single place a sink would attach, and it
// hard-strips anything that looks like personal or financial data BEFORE
// it could leave the process, so the redaction stays unit-testable
// whether or not a sink is connected.
//
// Every event here is a coarse enum + coarse props: role names, mode
// enums, small counts. NEVER a workspace/user id, a Space or person's
// name, an account identifier, an amount, or a counterparty.

export type SpacesEventName =
  | "household_created"
  | "member_invited"
  | "invite_accepted"
  | "member_removed"
  | "member_role_changed"
  | "source_shared"
  | "source_share_status_changed"
  | "source_visibility_narrowed"
  | "transaction_attributed"
  | "duplicate_merged"
  | "duplicate_dismissed"
  | "statement_imported"
  | "rule_scope_set";

// Keys that must never reach analytics, and value shapes that look like
// raw identifiers (a uuid, a 6+ digit run, an email, a URL).
const FORBIDDEN_KEY =
  /id$|_id|uuid|token|name|email|phone|msisdn|account|amount|balance|counterparty|reference|note/i;
const LOOKS_LIKE_IDENTIFIER =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(\d[\s-]?){6,}|@|https?:\/\//i;

export function sanitizeSpacesEventProps(
  props: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number") {
      // Only small, non-identifying counts. Round hard and cap.
      if (Number.isFinite(value)) out[key] = Math.min(Math.round(value), 100000);
      continue;
    }
    if (typeof value === "string") {
      if (LOOKS_LIKE_IDENTIFIER.test(value) || value.length > 32) continue;
      out[key] = value;
    }
  }
  return out;
}

export function trackSpacesEvent(
  name: SpacesEventName,
  props?: Record<string, unknown>,
): void {
  const safe = sanitizeSpacesEventProps(props);
  // No provider connected. When one is added, forward `{ name, ...safe }`
  // here - never the raw `props`. A tracking failure must never break the
  // user action that triggered it.
  try {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[spaces-event]", name, safe);
    }
  } catch {
    // ignore
  }
}
