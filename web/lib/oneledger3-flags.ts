// Feature flags for the OneLedger 3.0 surfaces (docs/oneledger-3). One pattern,
// stated once: OPT-IN (the flag must be exactly "true") plus an optional
// per-workspace allowlist for a staged rollout. An allowlist alone never
// enables anything. Pure (the env is passed in) so it is deno-testable.
//
//   INSIGHTS_CENTER_ENABLED       + INSIGHTS_CENTER_WORKSPACE_ALLOWLIST
//   BALANCE_PROVENANCE_ENABLED    + BALANCE_PROVENANCE_WORKSPACE_ALLOWLIST
//   COUNTERPARTIES_ENABLED        + COUNTERPARTIES_WORKSPACE_ALLOWLIST
//   PAYMENT_REQUESTS_ENABLED      + PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST
//
// The mobile API additionally requires MOBILE_API_ENABLED (mobile-api.ts).

export type OneLedger3Flag =
  | "INSIGHTS_CENTER"
  | "BALANCE_PROVENANCE"
  | "COUNTERPARTIES"
  | "PAYMENT_REQUESTS";

export function isOneLedger3FlagEnabled(
  env: Record<string, string | undefined>,
  flag: OneLedger3Flag,
  workspaceId: string | null,
): boolean {
  if (env[`${flag}_ENABLED`] !== "true") return false;
  const raw = env[`${flag}_WORKSPACE_ALLOWLIST`]?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  const allow = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allow.length === 0 || allow.includes(workspaceId);
}
