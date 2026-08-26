import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { runDailyReportDeliveryTick } from "../../../../lib/report-delivery";

// The scheduled-report email delivery tick's HTTP entry point (Phase G).
// Deliberately separate from generate-reports (master prompt §8/§9/§37 -
// generation and delivery are independently idempotent and independently
// retryable). Runs as a Vercel Route Handler for the same reason
// generation does (see generate-reports/route.ts's own comment) even
// though delivery itself has no budget-math dependency - keeping both
// cron endpoints on the same runtime avoids a second, unnecessary
// deployment target for one small feature.
//
// NOT YET WIRED TO A SCHEDULER - see generate-reports/route.ts's own
// comment; the same rollout-sequence reasoning applies here.
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runDailyReportDeliveryTick();
    if (summary.errors.length > 0) {
      console.error("deliver-reports: partial failure", summary.errors);
    }
    return NextResponse.json(summary);
  } catch (err) {
    console.error("deliver-reports: tick failed", err);
    return NextResponse.json({ error: "delivery tick failed" }, { status: 500 });
  }
}
