import { NextRequest } from "next/server";

import { mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { type MobileReportListItem, toMobileReportListItem } from "../../../../lib/mobile-reports";
import { getReportRuns } from "../../../../lib/queries";

// GET /api/mobile/reports - the user's daily report runs, newest first, for the
// mobile app (ADR 0019). A report belongs to its recipient (RLS:
// report_runs_select_own), across every Space they get reports in, exactly like
// the web's Reports page. Read-only; dates are formatted here in each report's
// own timezone (lib/mobile-reports.ts).

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "reports", async () => {
    const runs = await getReportRuns(30);
    const reports = runs
      .map(toMobileReportListItem)
      .filter((r): r is MobileReportListItem => r !== null);
    return { reports };
  });
}
