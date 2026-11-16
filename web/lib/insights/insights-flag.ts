// Rollout gate for the Insights Center (docs/oneledger-3/s6-insights-page.md).
// Same convention as the other dark features: off unless the flag is exactly
// "true"; an optional comma-separated workspace allowlist narrows it further.
// PURE (env is passed in) so it is deno-testable.

export type InsightsFlagEnv = {
  INSIGHTS_CENTER_ENABLED?: string;
  INSIGHTS_CENTER_WORKSPACE_ALLOWLIST?: string;
};

export function isInsightsCenterEnabledFor(
  env: InsightsFlagEnv,
  workspaceId: string | null | undefined,
): boolean {
  if (env.INSIGHTS_CENTER_ENABLED !== "true") return false;
  const raw = env.INSIGHTS_CENTER_WORKSPACE_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  return raw.split(",").map((s) => s.trim()).filter(Boolean).includes(
    workspaceId,
  );
}
