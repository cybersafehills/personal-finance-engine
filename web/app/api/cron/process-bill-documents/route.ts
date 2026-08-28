import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { runBillProcessingTick } from "../../../../lib/bills/worker";

// The Bills & Expenses extraction worker's HTTP entry point (master
// prompt §18). Runs as a Vercel Route Handler (not a Supabase Edge
// Function) so it can import web/lib/bills/extraction/* directly, the
// same architecture choice the reporting engine made.
//
// NOT YET WIRED TO A SCHEDULER - pg_cron activation is a later, separate,
// explicitly-approved step (supabase/scheduling/). Safe to call
// repeatedly: each document is claimed by a lifecycle transition and
// record_bill_extraction is idempotent per run. Does nothing at all
// unless BILLS_ENABLED and BILLS_EXTRACTION_ENABLED are both "true".
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runBillProcessingTick();
    if (summary.errors.length > 0) {
      console.error("[bill-worker] partial failure", summary.errors);
    }
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[bill-worker] tick failed", err);
    return NextResponse.json({ error: "processing tick failed" }, { status: 500 });
  }
}
