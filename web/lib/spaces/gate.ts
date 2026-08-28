import "server-only";

import { FeatureDisabledError } from "../pay/gate";

// Server-authoritative gating for the OneLedger Spaces (household
// collaboration) surface: creating a household, sharing a financial
// source into a Space, per-member transaction attribution, and the
// household notification-preference screen.
//
// Follows the SCAN_TO_PAY_ENABLED convention (see lib/pay/gate.ts): a
// brand-new, ledger-adjacent capability is OFF unless the flag is
// exactly the string "true", and an optional workspace allowlist scopes
// a staged internal -> beta -> GA rollout. A disabled flag blocks the
// server action, not merely a hidden button.
//
//   SPACES_ENABLED             - master switch for the whole surface.
//   SPACES_WORKSPACE_ALLOWLIST - if non-empty, ONLY these workspace ids
//                                see it. Empty / unset = every workspace.

function spacesAllowed(workspaceId: string | null): boolean {
  const raw = process.env.SPACES_WORKSPACE_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  const allow = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allow.length === 0 || allow.includes(workspaceId);
}

export function isSpacesEnabled(workspaceId: string | null): boolean {
  return process.env.SPACES_ENABLED === "true" && spacesAllowed(workspaceId);
}

export function assertSpacesEnabled(workspaceId: string | null): void {
  if (!isSpacesEnabled(workspaceId)) {
    throw new FeatureDisabledError("spaces");
  }
}
