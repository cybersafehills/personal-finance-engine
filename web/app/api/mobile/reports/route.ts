import { NextRequest } from "next/server";

import { mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { type MobileReportListItem, toMobileReportListItem } from "../../../../lib/mobile-reports";
import { getActiveWorkspaceId, getReportRunsStrict } from "../../../../lib/queries";

// GET /api/mobile/reports - the user's daily report runs, newest first, for the
// mobile app (ADR 0019). A report belongs to its recipient (RLS:
// report_runs_select_own), scoped to the selected Space for the Documents console. Read-only; dates are formatted here in each report's
// own timezone (lib/mobile-reports.ts).

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "reports", async () => {
    // Throws on a failed read (so the answer is a retryable error, never an
    // empty list that would read as "no reports yet").
    const workspaceId=await getActiveWorkspaceId();
    const runs = workspaceId ? await getReportRunsStrict(30,workspaceId) : [];
    const reports = runs
      .map(toMobileReportListItem)
      .filter((r): r is MobileReportListItem => r !== null);
    return { reports };
  });
}
