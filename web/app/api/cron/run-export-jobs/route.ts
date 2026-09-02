import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";
import { runExportJob } from "../../../../lib/integrations/export/run";
import { computeNextRun } from "../../../../lib/integrations/schedule";

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

  // Materialise due scheduled exports into export_jobs and advance them.
  let scheduled = 0;
  const nowIso = new Date().toISOString();
  const { data: dueSchedules } = await admin
    .from("export_schedules")
    .select(
      "id, workspace_id, created_by, name, config, destination_id, cadence, hour, day_of_week, day_of_month",
    )
    .eq("enabled", true)
    .lte("next_run_at", nowIso)
    .limit(20);
  for (const s of dueSchedules ?? []) {
    const { data: job } = await admin
      .from("export_jobs")
      .insert({
        workspace_id: s.workspace_id,
        created_by: s.created_by,
        config: s.config,
        destination_id: s.destination_id ?? null,
        format: (s.config as { format?: string })?.format === "csv"
          ? "csv"
          : "xlsx",
        status: "queued",
      })
      .select("id")
      .single();

    let ok = false;
    if (job) {
      const result = await runExportJob(job.id);
      ok = result.ok;
      if (ok) scheduled += 1;
      else failed += 1;
    }

    const nextRunAt = computeNextRun(
      {
        cadence: s.cadence,
        hour: s.hour,
        dayOfWeek: s.day_of_week,
        dayOfMonth: s.day_of_month,
        offsetMinutes: 0,
      },
      new Date(),
    );
    await admin
      .from("export_schedules")
      .update({ last_run_at: nowIso, next_run_at: nextRunAt })
      .eq("id", s.id);

    if (!ok && s.created_by) {
      await admin.from("notifications").insert({
        workspace_id: s.workspace_id,
        user_id: s.created_by,
        event_key: "integration.scheduled_export_failed",
        channel: "in_app",
        title: "A scheduled export failed",
        body: `"${s.name}" did not generate. It will try again on its next run.`,
        resource_type: "export_schedule",
        resource_id: s.id,
      });
    }
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

  return NextResponse.json({ ran, scheduled, failed, purged });
}
