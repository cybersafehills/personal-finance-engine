import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { runStatementScheduleTick } from "../../../../lib/statement-schedule";
import { logEvent, withLoggedRun } from "../../../../lib/log";

// Enqueues a statements stub for each due statement_schedules row and
// advances its next_run_at; the run-statement-jobs worker then finalizes
// each one. NOT YET WIRED TO A SCHEDULER - same posture as
// app/api/cron/generate-reports. Safe to call repeatedly: next_run_at is
// advanced per schedule on every tick.
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await withLoggedRun(
      "cron.run-statement-schedules",
      {},
      () => runStatementScheduleTick(),
    );
    if (summary.errors > 0) {
      logEvent("cron.run-statement-schedules", "error", {
        reason: "partial_failure",
        failed: summary.errors,
      });
    }
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "schedule tick failed" }, {
      status: 500,
    });
  }
}
