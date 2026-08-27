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
