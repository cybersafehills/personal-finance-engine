import "server-only";

// Server-authoritative gating for the Pay & Services capability.
//
// There is no general feature-flag system in this codebase (a prior
// phase decided none was needed - see docs). This mirrors the existing
// REPORT_GENERATION_ENABLED / REPORT_EMAIL_DELIVERY_ENABLED pattern in
// web/.env.local.example: an env var that is "on" unless it is the exact
// string "false", plus an optional comma-separated workspace allowlist
// for a staged beta. Both checks run on the server for every Pay/USSD
// action and query - a disabled flag blocks the backend, not just a
// hidden button (master prompt "Feature flags and rollout").
//
//   PAY_SERVICES_ENABLED           - master switch for the whole surface
//                                    (global Pay action, launcher, USSD).
//   USSD_DIRECTORY_ENABLED         - the USSD directory specifically.
//   PAY_SERVICES_WORKSPACE_ALLOWLIST - if non-empty, ONLY these workspace
//                                    ids see the surface (applies to both
//                                    flags). Empty/unset = everyone.

function envEnabled(name: string): boolean {
  return process.env[name] !== "false";
}

function workspaceAllowed(workspaceId: string | null): boolean {
  const raw = process.env.PAY_SERVICES_WORKSPACE_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  const allow = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.length === 0 || allow.includes(workspaceId);
}

export function isPayServicesEnabled(workspaceId: string | null): boolean {
  return envEnabled("PAY_SERVICES_ENABLED") && workspaceAllowed(workspaceId);
}

export function isUssdDirectoryEnabled(workspaceId: string | null): boolean {
  return (
    isPayServicesEnabled(workspaceId) && envEnabled("USSD_DIRECTORY_ENABLED")
  );
}

// --- Phase P: payment networks + directory admin + suggestions -----------
//
//   PAYMENT_NETWORKS_ENABLED    - the public eKash network pages + route
//                                 finder + route result (/pay/networks/**)
//                                 and their favourite/report actions.
//                                 On unless exactly "false".
//   DIRECTORY_ADMIN_ENABLED     - the /admin/directory surface + every
//                                 directory admin RPC action wrapper.
//                                 On unless exactly "false".
//   DIRECTORY_SUGGESTIONS_ENABLED - user "suggest a code / route" intake.
//                                 OFF unless exactly "true" (opt-in - it
//                                 ships behind moderation tooling being
//                                 operational, master prompt rollout
//                                 step 6, same convention as
//                                 SMS_RECONCILIATION_ENABLED).

export function isPaymentNetworksEnabled(workspaceId: string | null): boolean {
  return (
    isUssdDirectoryEnabled(workspaceId) && envEnabled("PAYMENT_NETWORKS_ENABLED")
  );
}

export function isDirectoryAdminEnabled(workspaceId: string | null): boolean {
  return isPayServicesEnabled(workspaceId) && envEnabled("DIRECTORY_ADMIN_ENABLED");
}

export function isDirectorySuggestionsEnabled(workspaceId: string | null): boolean {
  return (
    isUssdDirectoryEnabled(workspaceId) &&
    process.env.DIRECTORY_SUGGESTIONS_ENABLED === "true"
  );
}

export function assertPaymentNetworksEnabled(workspaceId: string | null): void {
  if (!isPaymentNetworksEnabled(workspaceId)) {
    throw new FeatureDisabledError("payment_networks");
  }
}

export function assertDirectoryAdminEnabled(workspaceId: string | null): void {
  if (!isDirectoryAdminEnabled(workspaceId)) {
    throw new FeatureDisabledError("directory_admin");
  }
}

export function assertDirectorySuggestionsEnabled(workspaceId: string | null): void {
  if (!isDirectorySuggestionsEnabled(workspaceId)) {
    throw new FeatureDisabledError("directory_suggestions");
  }
}

// --- Phase 2a: Assisted Quick Pay -----------------------------------------

export function isAssistedPayEnabled(workspaceId: string | null): boolean {
  return isPayServicesEnabled(workspaceId) && envEnabled("ASSISTED_PAY_ENABLED");
}

export function isPaymentTemplatesEnabled(workspaceId: string | null): boolean {
  return (
    isAssistedPayEnabled(workspaceId) && envEnabled("PAYMENT_TEMPLATES_ENABLED")
  );
}

export function isTrustedRecipientsEnabled(workspaceId: string | null): boolean {
  return (
    isAssistedPayEnabled(workspaceId) && envEnabled("TRUSTED_RECIPIENTS_ENABLED")
  );
}

// SMS-to-intent reconciliation (Phase 2b). OPT-IN: unlike every other
// Pay flag (on unless "false"), this is off unless explicitly "true" —
// it's a new, ledger-adjacent capability that ships behind an accuracy
// review (master prompt rollout steps 4-5).
export function isSmsReconciliationEnabled(workspaceId: string | null): boolean {
  return (
    isAssistedPayEnabled(workspaceId) &&
    process.env.SMS_RECONCILIATION_ENABLED === "true" &&
    workspaceAllowed(workspaceId)
  );
}

/** "observe" (default — record candidate links for accuracy review, don't
 *  mutate the intent/ledger) or "apply" (link + verify automatically). */
export function smsReconciliationMode(): "observe" | "apply" {
  return process.env.SMS_RECONCILIATION_MODE === "apply" ? "apply" : "observe";
}

// --- Phase R1: Scan to pay (QR payment scanner) -------------------------
//
//   SCAN_TO_PAY_ENABLED - the "Scan to pay" launcher entry + camera
//                         scanner. OPT-IN: off unless exactly "true",
//                         the same convention as SMS_RECONCILIATION_ENABLED
//                         (a new payment route that ships in stages —
//                         R1 is the camera shell only: no QR decoding,
//                         no payload parsing, no external handoff). The
//                         workspace allowlist still applies for a staged
//                         internal beta.
export function isScanToPayEnabled(workspaceId: string | null): boolean {
  return (
    isPayServicesEnabled(workspaceId) &&
    process.env.SCAN_TO_PAY_ENABLED === "true" &&
    workspaceAllowed(workspaceId)
  );
}

export function assertScanToPayEnabled(workspaceId: string | null): void {
  if (!isScanToPayEnabled(workspaceId)) {
    throw new FeatureDisabledError("scan_to_pay");
  }
}

/** Draft-intent TTL, in hours. Default 24. */
export function paymentIntentTtlHours(): number {
  const raw = Number(process.env.PAYMENT_INTENT_TTL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 24;
}

/** How recent a session must be (minutes) before we stop showing the
 *  "your session is a while old" soft notice on the review screen.
 *  Default 60. Phase 2a never blocks on this — it's advisory only. */
export function paymentSessionFreshnessMinutes(): number {
  const raw = Number(process.env.PAYMENT_SESSION_FRESHNESS_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60;
}

/** Thrown by the assert* helpers; server actions map it to a
 *  `{ ok: false, error }` and pages to a not-found / disabled state. */
export class FeatureDisabledError extends Error {
  constructor(feature: string) {
    super(`feature_disabled: ${feature}`);
    this.name = "FeatureDisabledError";
  }
}

export function assertPayServicesEnabled(workspaceId: string | null): void {
  if (!isPayServicesEnabled(workspaceId)) {
    throw new FeatureDisabledError("pay_services");
  }
}

export function assertUssdDirectoryEnabled(workspaceId: string | null): void {
  if (!isUssdDirectoryEnabled(workspaceId)) {
    throw new FeatureDisabledError("ussd_directory");
  }
}

export function assertAssistedPayEnabled(workspaceId: string | null): void {
  if (!isAssistedPayEnabled(workspaceId)) {
    throw new FeatureDisabledError("assisted_pay");
  }
}
