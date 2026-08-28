import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";
import { trackScanEvent } from "../../../../lib/pay/scan-analytics";

// Retry tick for Phase 2b SMS reconciliation: re-attempts a
// deterministic match for every still-open (initiated /
// awaiting_verification) payment intent whose verification window is
// still open. Covers the case where the payment SMS arrives after the
// user has already left the review screen, or ingestion ran before the
// intent existed.
//
// SOURCE-AGNOSTIC: it selects on `state` only, so Phase R3 `source =
// 'qr_scan'` intents are picked up here with no change. A scanned
// send-money USSD carries `recipient_msisdn_normalized`, so
// reconcile_payment_intent matches it exactly like an assisted
// pay_person; a scanned merchant/bill code has no msisdn and is skipped
// (`no_recipient_msisdn`) - the same limitation as assisted pay_merchant.
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
      .select("id, source")
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
    for (const { id, source } of (intents ?? []) as { id: string; source: string }[]) {
      const { data } = await supabase.rpc("reconcile_payment_intent", {
        p_intent_id: id,
        p_mode: mode,
      });
      const status = (data as { status?: string } | null)?.status;
      if (status === "linked") linked++;
      else if (status === "conflict") conflicts++;
      // Scan-originated attempts get their own lifecycle event (§13.1),
      // carrying only the coarse outcome - never the intent id.
      if ((status === "linked" || status === "conflict") && source === "qr_scan") {
        trackScanEvent("scan_attempt_reconciled", { outcome: status, mode });
      }
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
