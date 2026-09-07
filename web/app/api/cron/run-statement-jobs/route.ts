import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { runStatementJobsTick } from "../../../../lib/statement-generation";
import { logEvent, withLoggedRun } from "../../../../lib/log";

// Finalizes queued statements (status='generating') created by
// createStatement's async path: fetches, computes, renders the snapshot
// and flips the row to 'ready'. Idempotent per job.
//
// NOT YET WIRED TO A SCHEDULER - same posture as
// app/api/cron/generate-reports: this exists so the worker can be
// verified via an authenticated manual call before any recurring
// invocation. Safe to call repeatedly (each job's finalize wipes its
// children and the flip is conditional on status still being
// 'generating').
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await withLoggedRun(
      "cron.run-statement-jobs",
      {},
      () => runStatementJobsTick(),
    );
    if (summary.failed > 0) {
      logEvent("cron.run-statement-jobs", "error", {
        reason: "partial_failure",
        failed: summary.failed,
      });
    }
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "statement jobs tick failed" }, {
      status: 500,
    });
  }
}
