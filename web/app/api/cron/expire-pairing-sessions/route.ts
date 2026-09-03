import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";

// Device pairing v2 cleanup tick (ADR 0008, docs/device-pairing.md).
//
// Flips `pending` pairing sessions whose 10-minute TTL has elapsed to
// `expired` via the service-role-only `expire_stale_pairing_sessions()`
// RPC. Redemption already refuses a lapsed token on its own, so this is
// housekeeping - it keeps the table from accumulating stale `pending`
// rows and gives an operator a countable signal. Idempotent and safe at
// any frequency.
//
// NOT YET WIRED TO A SCHEDULER - same pattern as the other cron routes;
// see supabase/scheduling/README.md for the manual activation.
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = supabaseServer();
    const { data, error } = await db.rpc("expire_stale_pairing_sessions");
    if (error) {
      console.error("expire-pairing-sessions: rpc failed", error.message);
      return NextResponse.json({ error: "sweep failed" }, { status: 500 });
    }
    return NextResponse.json({ expired: data ?? 0 });
  } catch (err) {
    console.error("expire-pairing-sessions: tick failed", err);
    return NextResponse.json({ error: "sweep failed" }, { status: 500 });
  }
}
