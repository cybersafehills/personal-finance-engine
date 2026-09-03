import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";
import { runWorkbookSync } from "../../../../lib/integrations/workbooks/sync";
import { runLedgerSync } from "../../../../lib/integrations/accounting/sync";

// Drives the integration sync engine: re-runs connected-workbook and
// connected-ledger syncs that failed transiently and are now due for a
// retry, and fails runs that got stuck in `running` past the lease.
// Authenticated by the shared cron secret, never a browser session;
// excluded from the app middleware like every /api/cron/* route.
//
// Export-job delivery has its own retry path in run-export-jobs; this
// route only touches integration_sync_runs tied to a connected workbook
// or ledger. NOT YET WIRED TO A SCHEDULER.

const BATCH = 10;
const LEASE_MINUTES = 15;

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseServer();
  const nowIso = new Date().toISOString();
  const leaseCutoff = new Date(Date.now() - LEASE_MINUTES * 60_000).toISOString();

  // 1. Fail runs stuck in `running` past the lease.
  const { data: stuck } = await admin
    .from("integration_sync_runs")
    .select("id")
    .eq("status", "running")
    .lt("started_at", leaseCutoff)
    .limit(50);
  for (const run of stuck ?? []) {
    await admin
      .from("integration_sync_runs")
      .update({
        status: "failed",
        error: { code: "lease_expired" },
        finished_at: nowIso,
      })
      .eq("id", run.id)
      .eq("status", "running");
  }

  // 2. Retry due workbook sync runs.
  const { data: due, error } = await admin
    .from("integration_sync_runs")
    .select("id, workspace_id, connected_workbook_id, attempt, next_attempt_at")
    .eq("status", "queued")
    .not("connected_workbook_id", "is", null)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);
  if (error) {
    console.error("run-integration-syncs: query failed", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  let retried = 0;
  let failed = 0;
  for (const run of due ?? []) {
    // Claim: only proceed if this run is still queued.
    const { data: claimed } = await admin
      .from("integration_sync_runs")
      .update({
        status: "failed",
        error: { code: "superseded_by_retry" },
        finished_at: nowIso,
      })
      .eq("id", run.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const result = await runWorkbookSync(admin, {
      workbookId: run.connected_workbook_id as string,
      workspaceId: run.workspace_id as string,
      trigger: "poll",
      attempt: (run.attempt as number) ?? 0,
    });
    if (result.ok) retried += 1;
    else failed += 1;
  }

  // 3. Retry due connected-ledger sync runs (P3-PR7).
  const { data: dueLedgers } = await admin
    .from("integration_sync_runs")
    .select("id, workspace_id, connected_ledger_id, attempt, next_attempt_at")
    .eq("status", "queued")
    .not("connected_ledger_id", "is", null)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

  let ledgerRetried = 0;
  for (const run of dueLedgers ?? []) {
    const { data: claimed } = await admin
      .from("integration_sync_runs")
      .update({
        status: "failed",
        error: { code: "superseded_by_retry" },
        finished_at: nowIso,
      })
      .eq("id", run.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const result = await runLedgerSync(admin, {
      ledgerId: run.connected_ledger_id as string,
      workspaceId: run.workspace_id as string,
      trigger: "poll",
      attempt: (run.attempt as number) ?? 0,
    });
    if (result.ok) ledgerRetried += 1;
    else failed += 1;
  }

  return NextResponse.json({
    stuck_failed: (stuck ?? []).length,
    retried,
    ledger_retried: ledgerRetried,
    failed,
  });
}
