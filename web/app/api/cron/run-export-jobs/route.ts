import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";
import { runExportJob } from "../../../../lib/integrations/export/run";

// Runs export jobs that were left queued (row estimate above the inline
// limit) and re-claims jobs stuck in `processing` past the lease. Also
// purges the stored file of exports older than the retention window - the
// history row stays, the downloadable object does not. Authenticated by
// the shared cron secret (isAuthorizedCronRequest), never a browser
// session; excluded from the app middleware like every /api/cron/* route.
//
// NOT YET WIRED TO A SCHEDULER - same rollout reasoning as the other cron
// routes; the Export Center runs small exports inline in the meantime.

const BATCH = 10;
const LEASE_MINUTES = 15;
const RETENTION_DAYS = 7;

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseServer();
  const leaseCutoff = new Date(Date.now() - LEASE_MINUTES * 60_000).toISOString();

  const { data: candidates, error } = await admin
    .from("export_jobs")
    .select("id, status, started_at")
    .or(`status.eq.queued,and(status.eq.processing,started_at.lt.${leaseCutoff})`)
    .order("requested_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    console.error("run-export-jobs: candidate query failed", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  let ran = 0;
  let failed = 0;
  for (const job of candidates ?? []) {
    const claimToken = crypto.randomUUID();
    const { data: claimed } = await admin
      .from("export_jobs")
      .update({
        status: "processing",
        claim_token: claimToken,
        claimed_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", job.status)
      .select("id");
    if (!claimed || claimed.length === 0) continue; // taken by another run

    const result = await runExportJob(job.id);
    if (result.ok) ran += 1;
    else failed += 1;
  }

  // Retention: drop the stored file of old completed exports.
  const retentionCutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60_000,
  ).toISOString();
  const { data: expired } = await admin
    .from("export_jobs")
    .select("id, storage_path")
    .eq("status", "completed")
    .not("storage_path", "is", null)
    .lt("completed_at", retentionCutoff)
    .limit(100);
  let purged = 0;
  for (const job of expired ?? []) {
    if (!job.storage_path) continue;
    await admin.storage
      .from("integration-exports")
      .remove([job.storage_path as string]);
    await admin
      .from("export_jobs")
      .update({ storage_path: null })
      .eq("id", job.id);
    purged += 1;
  }

  return NextResponse.json({ ran, failed, purged });
}
