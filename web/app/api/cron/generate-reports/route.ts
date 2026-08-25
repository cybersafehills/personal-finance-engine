import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runDailyReportGenerationTick } from "../../../../lib/report-generation";

// The scheduled-report generation tick's HTTP entry point (master prompt
// §26 architecture decision: generation runs as a Vercel Route Handler,
// not a Supabase Edge Function, specifically so it can import
// web/lib/budget-math.ts directly rather than porting/duplicating budget
// calculation logic into Deno - see the architecture assessment).
//
// NOT YET WIRED TO A SCHEDULER. Per the Phase A rollout sequence, pg_cron
// activation is a later, separate, explicitly-approved production step
// (Phase 5) - this route exists now so generation logic can be verified
// against real production data via an authenticated manual call first
// (Phase 3 of that sequence), before any automatic recurring invocation
// exists. Calling this repeatedly is always safe regardless: every
// candidate is independently idempotent (report_runs_unique_period).
//
// Authenticated via a shared secret header, not a user session - the
// caller is a trusted scheduler (Postgres via pg_net, or a manual
// operator), never a browser. Constant-time comparison avoids a timing
// side-channel on the secret itself (master prompt §39).
export async function POST(request: NextRequest) {
  const configuredSecret = process.env.REPORT_CRON_SECRET;
  if (!configuredSecret) {
    console.error("generate-reports: REPORT_CRON_SECRET is not configured");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const provided = request.headers.get("x-report-cron-secret") ?? "";
  const configuredBuf = Buffer.from(configuredSecret);
  const providedBuf = Buffer.from(provided);
  const authorized = configuredBuf.length === providedBuf.length &&
    timingSafeEqual(configuredBuf, providedBuf);

  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runDailyReportGenerationTick();
    if (summary.errors.length > 0) {
      console.error("generate-reports: partial failure", summary.errors);
    }
    return NextResponse.json(summary);
  } catch (err) {
    console.error("generate-reports: tick failed", err);
    return NextResponse.json({ error: "generation tick failed" }, { status: 500 });
  }
}
