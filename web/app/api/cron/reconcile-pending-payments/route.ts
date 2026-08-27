import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";

// Retry tick for Phase 2b SMS reconciliation: re-attempts a
// deterministic match for every still-open (initiated /
// awaiting_verification) payment intent whose verification window is
// still open. Covers the case where the payment SMS arrives after the
// user has already left the review screen, or ingestion ran before the
// intent existed.
//
// OFF unless SMS_RECONCILIATION_ENABLED === "true". NOT YET WIRED TO A
// SCHEDULER (mirrors the other cron routes) - see
// supabase/scheduling/activate_payment_reconciliation.sql. Idempotent:
// reconcile_payment_intent only ever links an unlinked transaction and
// the partial-unique indexes on payment_reconciliations are the
// backstop.
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.SMS_RECONCILIATION_ENABLED !== "true") {
    return NextResponse.json({ skipped: "disabled" });
  }

  const mode = process.env.SMS_RECONCILIATION_MODE === "apply" ? "apply" : "observe";

  try {
    const supabase = supabaseServer();
    const { data: intents, error } = await supabase
      .from("payment_intents")
      .select("id")
      .in("state", ["initiated", "awaiting_verification"])
      .is("linked_transaction_id", null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .limit(500);

    if (error) {
      console.error("reconcile-pending-payments: query failed", error.message);
      return NextResponse.json({ error: "query failed" }, { status: 500 });
    }

    let linked = 0;
    let conflicts = 0;
    for (const { id } of intents ?? []) {
      const { data } = await supabase.rpc("reconcile_payment_intent", {
        p_intent_id: id,
        p_mode: mode,
      });
      const status = (data as { status?: string } | null)?.status;
      if (status === "linked") linked++;
      else if (status === "conflict") conflicts++;
    }

    return NextResponse.json({
      scanned: intents?.length ?? 0,
      linked,
      conflicts,
      mode,
    });
  } catch (err) {
    console.error("reconcile-pending-payments: tick failed", err);
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
