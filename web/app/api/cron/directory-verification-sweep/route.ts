import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import { supabaseServer } from "../../../../lib/supabase-server";

// Directory verification-freshness sweep (master prompt section 15).
//
// Read-only over the directory content: it NEVER unpublishes anything.
// It counts the entries whose review_due_at has elapsed and the
// entries carrying repeated unresolved reports, writes ONE audit summary
// row so there is an observable trail, and returns the digest. The
// admin dashboard (/admin/directory) already surfaces the same signals
// live; this tick makes them auditable and is the hook an email/alert
// digest would attach to.
//
// NOT YET WIRED TO A SCHEDULER — same pattern as the other cron routes:
// the pg_cron activation is a separate manual step
// (supabase/scheduling/activate_directory_verification_sweep.sql).
// Idempotent and safe to call at any frequency.

const REPEATED_REPORT_THRESHOLD = 3;

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = supabaseServer();
    const nowIso = new Date().toISOString();

    const [networks, participation, routes, openReports] = await Promise.all([
      db
        .from("payment_networks")
        .select("id", { count: "exact", head: true })
        .eq("state", "published")
        .lte("review_due_at", nowIso),
      db
        .from("institution_network_participation")
        .select("id", { count: "exact", head: true })
        .eq("state", "published")
        .lte("review_due_at", nowIso),
      db
        .from("access_routes")
        .select("id", { count: "exact", head: true })
        .eq("state", "published")
        .lte("review_due_at", nowIso),
      db
        .from("service_code_reports")
        .select("service_code_id, access_route_id")
        .in("status", ["open", "reviewing"]),
    ]);

    // Entries carrying >= threshold unresolved reports.
    const counts = new Map<string, number>();
    for (const r of (openReports.data ?? []) as {
      service_code_id: string | null;
      access_route_id: string | null;
    }[]) {
      const key = r.service_code_id
        ? `service_code:${r.service_code_id}`
        : `access_route:${r.access_route_id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const repeatedReportEntries = [...counts.values()].filter(
      (n) => n >= REPEATED_REPORT_THRESHOLD,
    ).length;

    const summary = {
      swept_at: nowIso,
      review_due: {
        payment_networks: networks.count ?? 0,
        institution_participation: participation.count ?? 0,
        access_routes: routes.count ?? 0,
      },
      repeated_report_entries: repeatedReportEntries,
      repeated_report_threshold: REPEATED_REPORT_THRESHOLD,
    };

    const hasSignal =
      (networks.count ?? 0) +
        (participation.count ?? 0) +
        (routes.count ?? 0) +
        repeatedReportEntries >
      0;

    // One audit row per tick, only when there's something to flag - keeps
    // the trail meaningful rather than a heartbeat log.
    if (hasSignal) {
      await db.from("service_directory_audit_events").insert({
        action: "directory.verification_sweep",
        subject_type: "directory_sweep",
        after_state: summary,
        reason: "scheduled verification-freshness sweep",
      });
    }

    return NextResponse.json({ ...summary, audited: hasSignal });
  } catch (err) {
    console.error("directory-verification-sweep: tick failed", err);
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
