import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { runDailyReportGenerationTick } from "../../../../lib/report-generation";

// The scheduled-report generation tick's HTTP entry point (master prompt
// §26 architecture decision: generation runs as a Vercel Route Handler,
// not a Supabase Edge Function, specifically so it can import
// web/lib/budget-math.ts directly rather than porting/duplicating budget
// calculation logic into Deno - see the architecture assessment).
//
// NOT YET WIRED TO A SCHEDULER. Per the Phase A rollout sequence, pg_cron
// activation is a later, separate, explicitly-approved production step
// (Phase 5) - this route exists now so generation logic can be verified
// against real production data via an authenticated manual call first
// (Phase 3 of that sequence), before any automatic recurring invocation
// exists. Calling this repeatedly is always safe regardless: every
// candidate is independently idempotent (report_runs_unique_period).
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runDailyReportGenerationTick();
    if (summary.errors.length > 0) {
      console.error("generate-reports: partial failure", summary.errors);
    }
    return NextResponse.json(summary);
  } catch (err) {
    console.error("generate-reports: tick failed", err);
    return NextResponse.json({ error: "generation tick failed" }, { status: 500 });
  }
}
