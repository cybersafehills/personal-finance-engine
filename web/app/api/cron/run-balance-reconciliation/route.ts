import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";

// Operator/scheduler entry point for the balance-reconciliation sweep
// (Integrations Phase 3, P3-PR2). The actual work - running the canonical
// reconciliation engine and upserting balance_reconciliations - lives in
// the `reconcile-balances` Edge Function, because that engine
// (supabase/functions/_shared/reconciliation.ts) is Deno-only and must
// never be reimplemented. This route just forwards an authenticated
// trigger to it, so the sweep can be driven the same way as every other
// cron here (x-report-cron-secret) in addition to a direct Supabase
// Functions schedule.
//
// OFF unless BALANCE_RECONCILIATION_ENABLED === "true" here AND the
// function's own BALANCE_RECONCILIATION_ENABLED=enabled Edge secret is
// set. NOT YET WIRED TO A SCHEDULER (mirrors every other cron route).
// Idempotent: the function upserts by transaction_id.
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.BALANCE_RECONCILIATION_ENABLED !== "true") {
    return NextResponse.json({ skipped: "disabled" });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("run-balance-reconciliation: Supabase env not configured");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  // Optional passthrough: { account_ids?: string[], limit?: number }.
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // No body - the function runs its default account-discovery sweep.
  }

  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/reconcile-balances`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body ?? {}),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("run-balance-reconciliation: function returned", res.status);
      return NextResponse.json(
        { error: "reconcile function failed", status: res.status, payload },
        { status: 502 },
      );
    }
    return NextResponse.json(payload);
  } catch (err) {
    console.error("run-balance-reconciliation: invoke failed", err);
    return NextResponse.json({ error: "invoke failed" }, { status: 500 });
  }
}
