import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";
import { deliverWebhook } from "../../../../lib/integrations/webhooks/deliver";

// Delivers pending / retry-due webhook_deliveries rows (Integrations
// Phase 4). Claim/lease pattern: mark the row with a claim_token, then
// deliver. Re-releases rows stuck `pending` with a claim past the lease.
// Also purges old delivered rows. Cron-secret authenticated; excluded
// from the app middleware like every /api/cron/* route. NOT scheduler-wired.

const BATCH = 20;
const LEASE_MINUTES = 10;
const RETENTION_DAYS = 30;

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseServer();
  const nowIso = new Date().toISOString();
  const leaseCutoff = new Date(Date.now() - LEASE_MINUTES * 60_000).toISOString();

  // Release rows whose claim has expired but never completed.
  await admin
    .from("webhook_deliveries")
    .update({ claim_token: null, claimed_at: null })
    .eq("status", "pending")
    .not("claim_token", "is", null)
    .lt("claimed_at", leaseCutoff);

  const { data: due, error } = await admin
    .from("webhook_deliveries")
    .select(
      "id, subscription_id, workspace_id, event_type, payload, attempt, created_at",
    )
    .eq("status", "pending")
    .is("claim_token", null)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);
  if (error) {
    console.error("deliver-webhooks: query failed", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  let delivered = 0;
  let requeued = 0;
  let failed = 0;
  for (const row of due ?? []) {
    const claimToken = crypto.randomUUID();
    const { data: claimed } = await admin
      .from("webhook_deliveries")
      .update({ claim_token: claimToken, claimed_at: nowIso })
      .eq("id", row.id)
      .eq("status", "pending")
      .is("claim_token", null)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const result = await deliverWebhook(admin, row);
    if (result.status === "delivered") delivered += 1;
    else if (result.status === "queued") requeued += 1;
    else failed += 1;
  }

  // Retention: drop old delivered rows.
  const retentionCutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60_000,
  ).toISOString();
  const { count: purged } = await admin
    .from("webhook_deliveries")
    .delete({ count: "exact" })
    .eq("status", "delivered")
    .lt("created_at", retentionCutoff);

  return NextResponse.json({
    delivered,
    requeued,
    failed,
    purged: purged ?? 0,
  });
}
