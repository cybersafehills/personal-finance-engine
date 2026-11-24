import { NextRequest } from "next/server";

import { serializeIntelligence } from "../../../../../lib/intelligence/intelligence-api";
import { getIntelligenceInsights, isIntelligenceEnabled } from "../../../../../lib/intelligence/insights";
import { MobileApiError, mobileGet, mobileOptions } from "../../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../../lib/mobile-workspace";
import { getActiveWorkspaceId } from "../../../../../lib/queries";

// GET /api/mobile/insights/intelligence - spending vs. your usual pace, unusually
// large payments, detected recurring payments and the one-line summary: the same
// facts the web's Home Insights card shows (ADR 0014, deterministic only). The
// per-wallet projections stay on /insights/forecast. Read-only; dark unless
// INSIGHTS_CENTER and INTELLIGENCE_ENABLED (+ allowlists) cover the workspace.

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "insights-intelligence", async () => {
    const { workspaceId } = await resolveMobileWorkspace(null);
    if (workspaceId !== await getActiveWorkspaceId() || !isIntelligenceEnabled(workspaceId)) {
      throw new MobileApiError(404, "not_found");
    }
    requireFlag("INSIGHTS_CENTER", workspaceId);

    const insights = await getIntelligenceInsights();
    if (!insights.enabled) throw new MobileApiError(404, "not_found");

    try {
      return {
        workspace_id: workspaceId,
        computed_at: new Date().toISOString(),
        ...serializeIntelligence(insights),
      };
    } catch (error) {
      if (error instanceof RangeError) throw new MobileApiError(422, "intelligence_unavailable");
      throw error;
    }
  });
}
