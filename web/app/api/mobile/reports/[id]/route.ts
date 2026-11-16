import { NextRequest } from "next/server";

import { mobileGet, mobileOptions } from "../../../../../lib/mobile-request";
import { isUuid } from "../../../../../lib/mobile-pay";
import { toMobileReport } from "../../../../../lib/mobile-reports";
import { getReportRunByIdStrict } from "../../../../../lib/queries";

// GET /api/mobile/reports/:id - one report, with every figure from its stored
// snapshot (never recomputed) and every sentence and date rendered by the same
// functions the web and the morning email use. Read under the caller's own RLS
// session, so another user's id is just "not found". Read-only.

export const OPTIONS = mobileOptions;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mobileGet(request, "report", async () => {
    if (!isUuid(id)) return { report: null, reason: "not_found" };
    // Throws on a failed read (a retryable error, not "not found"); null only
    // when there is genuinely no such report for this user.
    const run = await getReportRunByIdStrict(id);
    const report = run ? toMobileReport(run) : null;
    return report ? { report } : { report: null, reason: "not_found" };
  });
}
