import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";

// Retention purge for the developer API request log (Integrations Phase 4).
// Drops api_request_log rows older than the window and prunes stale
// api_rate_buckets. Authenticated by the shared cron secret; excluded from
// the app middleware like every /api/cron/* route. NOT scheduler-wired.

const RETENTION_DAYS = 30;

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseServer();
  const logCutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60_000,
  ).toISOString();
  const bucketCutoff = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

  const { count: logs, error: logErr } = await admin
    .from("api_request_log")
    .delete({ count: "exact" })
    .lt("created_at", logCutoff);
  if (logErr) {
    console.error("purge-api-logs: log delete failed", logErr.message);
    return NextResponse.json({ error: "purge failed" }, { status: 500 });
  }

  const { count: buckets } = await admin
    .from("api_rate_buckets")
    .delete({ count: "exact" })
    .lt("window_start", bucketCutoff);

  return NextResponse.json({
    logs_purged: logs ?? 0,
    rate_buckets_purged: buckets ?? 0,
  });
}
