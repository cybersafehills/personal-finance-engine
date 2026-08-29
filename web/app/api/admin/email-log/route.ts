import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";

// Operator-only view of email_send_log (20261007000000_email_send_log.sql).
// Same shared-secret gate as the cron routes and /api/health/email - never
// a browser session. The table is service_role-only, so this route reads
// it with supabaseServer(). Rows carry a recipient DOMAIN only, never an
// address, subject, or body.
//
//   GET /api/admin/email-log?limit=50&outcome=failed
//
//   limit   - 1..200, default 50
//   outcome - optional: sent | skipped | failed
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    200,
    Math.max(1, Number(searchParams.get("limit")) || 50),
  );
  const outcome = searchParams.get("outcome");

  let query = supabaseServer()
    .from("email_send_log")
    .select(
      "id, created_at, outcome, category, recipient_domain, workspace_id, provider_message_id, error_code",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (outcome === "sent" || outcome === "skipped" || outcome === "failed") {
    query = query.eq("outcome", outcome);
  }

  const { data, error } = await query;

  if (error) {
    console.error("email-log route: query failed", error.message);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  return NextResponse.json({ count: data?.length ?? 0, rows: data ?? [] });
}
