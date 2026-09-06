import "server-only";

import { supabaseSession } from "../supabase-session-server";
import {
  type Entitlement,
  isPlan,
  type Plan,
  planHasEntitlement,
} from "./plans.ts";

// Server-side entitlement resolution (ADR 0015 / master prompt section
// 52). Mirrors lib/experience-mode/gate.ts: an env flag decides whether
// entitlement checks are LIVE, the plan itself is read per-workspace from
// workspace_plans (RLS-scoped), and the tier -> capability map stays in
// plans.ts.
//
//   ENTITLEMENTS_ENABLED    - master switch. Off (default) => every
//                             entitlement check returns true, i.e. exactly
//                             today's behavior, nothing restricted.
//   ENTITLEMENTS_ALLOWLIST  - optional comma-separated workspace-id
//                             allowlist for a staged rollout.
//
// An entitlement NEVER gates a user's own data, export, deletion, or
// security (assessment section 7) - see plans.ts.

export function isEntitlementsEnabled(workspaceId: string | null): boolean {
  if (process.env.ENTITLEMENTS_ENABLED !== "true") return false;
  const raw = process.env.ENTITLEMENTS_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(workspaceId);
}

export type WorkspacePlanState = {
  plan: Plan;
  trialEndsAt: string | null;
  /** trialEndsAt is set and still in the future. */
  onTrial: boolean;
  /** True when entitlement checks are live for this workspace right now. */
  enforced: boolean;
};

function computeOnTrial(trialEndsAt: string | null): boolean {
  return trialEndsAt != null && Date.parse(trialEndsAt) > Date.now();
}

/**
 * The workspace's stored plan. Always reads the real row (so the Billing
 * & Plan page shows the truth even while enforcement is dark); `free` on
 * a missing row, a read failure, or no active workspace.
 */
export async function getWorkspacePlanState(
  workspaceId: string | null,
): Promise<WorkspacePlanState> {
  const enforced = isEntitlementsEnabled(workspaceId);
  if (!workspaceId) {
    return { plan: "free", trialEndsAt: null, onTrial: false, enforced };
  }

  try {
    const supabase = await supabaseSession();
    const { data } = await supabase
      .from("workspace_plans")
      .select("plan, trial_ends_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const trialEndsAt = (data?.trial_ends_at as string | null) ?? null;
    return {
      plan: isPlan(data?.plan) ? data.plan : "free",
      trialEndsAt,
      onTrial: computeOnTrial(trialEndsAt),
      enforced,
    };
  } catch {
    // Pre-migration or any read failure: fall back to free, never throw.
    return { plan: "free", trialEndsAt: null, onTrial: false, enforced };
  }
}

export async function getWorkspacePlan(
  workspaceId: string | null,
): Promise<Plan> {
  return (await getWorkspacePlanState(workspaceId)).plan;
}

/**
 * Does this workspace currently have `entitlement`?
 *
 * When enforcement is dark for the workspace this returns `true` - the
 * whole point of the flag is that no behavior changes until it is on.
 * When live, it checks the stored plan against the tier map. A trial is
 * modelled by storing the target plan on the row (assigned_by='trial' +
 * trial_ends_at), so no special-casing is needed here; a cron/admin
 * downgrades when the window closes.
 */
export async function workspaceHasEntitlement(
  workspaceId: string | null,
  entitlement: Entitlement,
): Promise<boolean> {
  const state = await getWorkspacePlanState(workspaceId);
  if (!state.enforced) return true;
  return planHasEntitlement(state.plan, entitlement);
}
