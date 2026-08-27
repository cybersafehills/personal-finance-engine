import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";

// Sweeps stale payment intents (state initiated / awaiting_verification
// past their expires_at) to `expired`. Assisted Quick Pay also filters
// lazily in the UI (lib/pay/intents.ts withLazyExpiry), so this tick is
// belt-and-braces — it makes the stored state authoritative and writes
// the lifecycle event.
//
// NOT YET WIRED TO A SCHEDULER. Mirrors the report-generation route: the
// pg_cron activation is a separate, manual step
// (supabase/scheduling/activate_payment_intent_expiry.sql). Calling this
// repeatedly is always safe — expire_stale_payment_intents only ever
// touches rows that are genuinely past due and non-terminal.
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = supabaseServer();
    const { data, error } = await supabase.rpc("expire_stale_payment_intents", {
      p_now: new Date().toISOString(),
    });
    if (error) {
      console.error("expire-payment-intents: rpc failed", error.message);
      return NextResponse.json({ error: "sweep failed" }, { status: 500 });
    }
    return NextResponse.json({ expired: (data as number) ?? 0 });
  } catch (err) {
    console.error("expire-payment-intents: tick failed", err);
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
