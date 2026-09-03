import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { runBillMonitoringTick } from "../../../../lib/bills/monitoring";

// Operational metrics tick for Bills & Expenses (master prompt §25).
// Emits coarse aggregate counts to the platform log drain
// (`[bill-metrics] …`). No document content. Not wired to a scheduler
// yet - see supabase/scheduling/activate_bill_workers.sql. Safe to call
// at any frequency.
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const metrics = await runBillMonitoringTick();
    return NextResponse.json(metrics);
  } catch (err) {
    console.error("[bill-metrics] tick failed", err);
    return NextResponse.json({ error: "monitoring tick failed" }, { status: 500 });
  }
}
