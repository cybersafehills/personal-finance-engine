import { NextRequest } from "next/server";

import { MobileApiError, mobileGet, mobileOptions } from "../../../../../../lib/mobile-request";
import { parsePlanId, toMobilePlan } from "../../../../../../lib/mobile-splits";
import { isAssistedPayEnabled, isPaySplitsEnabled } from "../../../../../../lib/pay/gate";
import { getSplitPlan } from "../../../../../../lib/pay/splits/plans";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";

// GET /api/mobile/pay/splits/:id - a Save On plan and where it stands: the parts
// already prepared, which part (if any) can be prepared next, and what is left.
// Read under the caller's own RLS session, so another user's plan is "not found".
// `next.status` is "ready" only when the previous part is settled.

export const OPTIONS = mobileOptions;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return mobileGet(request, "pay-split-plan", async () => {
    const planId = parsePlanId(id);
    if (!planId) throw new MobileApiError(404, "not_found", "That split couldn't be found.");
    const workspaceId = await getActiveWorkspaceId();
    if (!isAssistedPayEnabled(workspaceId) || !isPaySplitsEnabled(workspaceId)) {
      throw new MobileApiError(403, "feature_disabled", "Splits are not turned on for your account.");
    }
    const loaded = await getSplitPlan(planId);
    if (!loaded) throw new MobileApiError(404, "not_found", "That split couldn't be found.");
    return { plan: toMobilePlan(loaded.plan, loaded.parts) };
  });
}
