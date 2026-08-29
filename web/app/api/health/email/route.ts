import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { checkEmailConfig } from "../../../../lib/email-health";

// Operator-only config check for the transactional-email path. Same
// shared-secret gate as the cron routes (X-Report-Cron-Secret) - never a
// browser session. Read-only: it inspects env + queries Resend for the
// sending domain's verification status, and sends nothing.
//
// Returns 200 with the report when there are no error-level issues, 503
// with the same body when there are - so a CI/monitoring `curl --fail`
// against a deployed environment catches a broken email setup. The body
// never contains a key value, only whether each var is set / well-shaped.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const report = await checkEmailConfig();
  return NextResponse.json(report, { status: report.ok ? 200 : 503 });
}
