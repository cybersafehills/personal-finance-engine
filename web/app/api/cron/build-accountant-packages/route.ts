import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";
import { runAccountantPackageBuild } from "../../../../lib/integrations/accountant/build";

// Builds accountant packages left queued (period row estimate above the
// inline limit) and re-claims packages stuck in `building` past the lease.
// Also purges the stored ZIP of packages older than the retention window -
// the history row stays, the downloadable object does not. Authenticated
// by the shared cron secret; excluded from the app middleware like every
// /api/cron/* route. NOT YET WIRED TO A SCHEDULER - small packages run
// inline in the createAccountantPackage action meanwhile.

const BATCH = 5;
const LEASE_MINUTES = 15;
const RETENTION_DAYS = 30;

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseServer();
  const leaseCutoff = new Date(Date.now() - LEASE_MINUTES * 60_000).toISOString();

  const { data: candidates, error } = await admin
    .from("accountant_packages")
    .select("id, status, started_at")
    .or(
      `status.eq.queued,and(status.eq.building,started_at.lt.${leaseCutoff})`,
    )
    .order("requested_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    console.error("build-accountant-packages: candidate query failed", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  let ran = 0;
  let failed = 0;
  for (const pkg of candidates ?? []) {
    const claimToken = crypto.randomUUID();
    const { data: claimed } = await admin
      .from("accountant_packages")
      .update({
        status: "building",
        claim_token: claimToken,
        claimed_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
      })
      .eq("id", pkg.id)
      .eq("status", pkg.status)
      .select("id");
    if (!claimed || claimed.length === 0) continue; // taken by another run

    const result = await runAccountantPackageBuild(pkg.id);
    if (result.ok) ran += 1;
    else failed += 1;
  }

  // Retention: drop the stored ZIP of old ready packages.
  const retentionCutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60_000,
  ).toISOString();
  const { data: expired } = await admin
    .from("accountant_packages")
    .select("id, storage_path")
    .eq("status", "ready")
    .not("storage_path", "is", null)
    .lt("completed_at", retentionCutoff)
    .limit(100);
  let purged = 0;
  for (const pkg of expired ?? []) {
    if (!pkg.storage_path) continue;
    await admin.storage
      .from("integration-accountant-packages")
      .remove([pkg.storage_path as string]);
    await admin
      .from("accountant_packages")
      .update({ storage_path: null })
      .eq("id", pkg.id);
    purged += 1;
  }

  return NextResponse.json({ ran, failed, purged });
}
