import { NextRequest } from "next/server";

import { MobileApiError, mobileGet, mobileOptions } from "../../../../../../lib/mobile-request";
import { isAssistedPayEnabled, isPaySplitsEnabled } from "../../../../../../lib/pay/gate";
import { loadSaveOnReport } from "../../../../../../lib/pay/splits/savings";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";

// GET /api/mobile/pay/splits/savings - how much the person has saved in transfer fees
// with Save On: the same totals over 24 hours, 7 days, 2 weeks, a month, 3 months,
// 12 months and all time, what is still being sent, and the latest completed plans.
// A saving counts only once every part of a plan is settled; figures are estimates from
// the provider's published fee table. Read-only, under the caller's own RLS, for the
// active Space.

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "pay-split-savings", async () => {
    const workspaceId = await getActiveWorkspaceId();
    if (!workspaceId || !isAssistedPayEnabled(workspaceId) || !isPaySplitsEnabled(workspaceId)) {
      throw new MobileApiError(403, "feature_disabled", "Save On is not turned on for your account.");
    }
    const report = await loadSaveOnReport(await supabaseSession(), workspaceId);
    if (!report) throw new Error("save on report unreadable");
    return { report };
  });
}
