import "server-only";

import {
  type ExperienceMode,
  experienceModeForWorkspaceKind,
} from "../experience-mode.ts";
import type { WorkspaceKind, WorkspaceSummary } from "../queries";

// Server-side resolution of the active Space's experience mode, plus the
// dark-by-default gate for the Business-only surfaces (assessment section
// 6.2 + guardrail "Business rollout should remain feature gated").
//
//   EXPERIENCE_MODE_BUSINESS_ENABLED    - master switch for the
//                                         business-only surfaces (bills,
//                                         reconciliation, accounting
//                                         connectors, developer platform).
//   EXPERIENCE_MODE_BUSINESS_ALLOWLIST  - optional comma-separated
//                                         workspace-id allowlist.
//
// When off, an `organization` Space still resolves to "business" mode
// (so copy/labels are right) but those surfaces render as if in
// "household" mode. The mode is NEVER an authorization check - it only
// decides what is shown; every action re-checks capability + scope.

export function resolveExperienceMode(
  activeWorkspaceId: string | null,
  workspaces: readonly WorkspaceSummary[],
): ExperienceMode {
  const kind: WorkspaceKind =
    workspaces.find((w) => w.id === activeWorkspaceId)?.kind ?? "personal";
  return experienceModeForWorkspaceKind(kind);
}

export function isBusinessSurfacesEnabled(
  workspaceId: string | null,
): boolean {
  if (process.env.EXPERIENCE_MODE_BUSINESS_ENABLED !== "true") return false;
  const raw = process.env.EXPERIENCE_MODE_BUSINESS_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(workspaceId);
}
