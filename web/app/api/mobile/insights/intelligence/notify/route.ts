import { NextRequest } from "next/server";

import { noteInsightChange } from "../../../../../actions/insight-glimpse";
import { getIntelligenceInsights, isIntelligenceEnabled } from "../../../../../../lib/intelligence/insights";
import { summariseInsights } from "../../../../../../lib/intelligence/summary";
import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../../../lib/mobile-workspace";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";

// POST /api/mobile/insights/intelligence/notify - the app's counterpart of the web
// layout's glimpse: records the caller's current insight signature and, only when it
// really changed AND 12 hours have passed, enqueues one `insight.forecast_update`
// notification (the same RPC, note_insight_change, so web and app share one
// de-dupe and one rate limit - opening both never doubles it). Takes no input.
// Never fails the app: anything unexpected answers { notified: false }.

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "insights-notify", async () => {
    const { workspaceId } = await resolveMobileWorkspace(null);
    if (workspaceId !== await getActiveWorkspaceId() || !isIntelligenceEnabled(workspaceId)) {
      throw new MobileApiError(404, "not_found");
    }
    requireFlag("INSIGHTS_CENTER", workspaceId);

    const insights = await getIntelligenceInsights();
    const glimpse = insights.enabled ? summariseInsights(insights) : null;
    if (!glimpse) return { workspace_id: workspaceId, notified: false };
    return { workspace_id: workspaceId, notified: await noteInsightChange(workspaceId, glimpse) };
  });
}
