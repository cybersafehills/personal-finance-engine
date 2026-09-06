import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";
import { isAccountDeletionExecuteEnabled } from "../../../../lib/account-deletion";

// Account erasure tick (ADR 0016 §3, audit F12). Drains
// account_deletion_requests whose 30-day grace window has closed:
// `pending_account_deletions()` returns the due user ids,
// `execute_account_deletion()` erases each. Both RPCs are service-role
// only.
//
// DARK by default: does nothing unless ACCOUNT_DELETION_EXECUTE_ENABLED
// is exactly "true". This is the deliberate second switch - a user can
// schedule and cancel deletion with ACCOUNT_DELETION_ENABLED alone;
// nothing is actually erased until an operator also flips this one and
// wires the scheduler (supabase/scheduling/README.md).
//
// Per-user failures are isolated and logged; the tick still reports how
// many succeeded so a stuck request is visible without blocking the rest.
const BATCH = 25;

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isAccountDeletionExecuteEnabled()) {
    return NextResponse.json({ skipped: "disabled", erased: 0 });
  }

  try {
    const db = supabaseServer();
    const { data: due, error: queueError } = await db.rpc(
      "pending_account_deletions",
      { p_limit: BATCH },
    );
    if (queueError) {
      console.error("process-account-deletions: queue read failed", queueError.message);
      return NextResponse.json({ error: "queue read failed" }, { status: 500 });
    }

    const userIds: string[] = (due ?? []) as string[];
    let erased = 0;
    const failed: string[] = [];

    for (const userId of userIds) {
      const { error } = await db.rpc("execute_account_deletion", {
        p_user_id: userId,
      });
      if (error) {
        // No user id in the log line - it identifies a person.
        console.error("process-account-deletions: erasure failed", error.code, error.message);
        failed.push(userId);
        continue;
      }
      erased += 1;
    }

    return NextResponse.json({
      due: userIds.length,
      erased,
      failed: failed.length,
    });
  } catch (err) {
    console.error("process-account-deletions: tick failed", err);
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
