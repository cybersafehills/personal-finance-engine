import "server-only";
import { supabaseServer } from "../supabase-server";

// Operational monitoring for Bills & Expenses (master prompt §25). This
// codebase has no APM; the sink is structured console output with a
// stable prefix (the platform log drain), the same choice the reporting
// engine and the scan module made. Emits only coarse aggregate counts -
// never a document, supplier, amount, or workspace id.

export type BillMetrics = {
  at: string;
  queued: number;
  in_flight: number; // scanning..validating
  needs_review: number;
  processing_failed: number;
  posted_24h: number;
  matched_24h: number;
  oldest_needs_review_hours: number | null;
  avg_approval_turnaround_hours: number | null;
};

async function countByStatus(
  admin: ReturnType<typeof supabaseServer>,
  statuses: string[],
): Promise<number> {
  const { count } = await admin
    .from("bill_documents")
    .select("id", { count: "exact", head: true })
    .in("status", statuses);
  return count ?? 0;
}

export async function runBillMonitoringTick(): Promise<BillMetrics> {
  const admin = supabaseServer();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [queued, inFlight, needsReview, failed] = await Promise.all([
    countByStatus(admin, ["queued"]),
    countByStatus(admin, ["scanning", "classifying", "extracting", "validating"]),
    countByStatus(admin, ["needs_review", "under_review", "awaiting_clarification"]),
    countByStatus(admin, ["processing_failed"]),
  ]);

  const { count: posted24h } = await admin
    .from("bill_documents")
    .select("id", { count: "exact", head: true })
    .eq("status", "posted")
    .gte("updated_at", since);
  const { count: matched24h } = await admin
    .from("bill_documents")
    .select("id", { count: "exact", head: true })
    .eq("status", "matched")
    .gte("updated_at", since);

  const { data: oldest } = await admin
    .from("bill_documents")
    .select("updated_at")
    .in("status", ["needs_review", "under_review"])
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const oldestHours = oldest?.updated_at
    ? Math.round((Date.now() - Date.parse(oldest.updated_at)) / 3600_000)
    : null;

  const { data: turnaround } = await admin
    .from("bills")
    .select("approved_at, created_at")
    .gte("approved_at", since)
    .limit(500);
  let avgTurnaround: number | null = null;
  if (turnaround && turnaround.length > 0) {
    const hrs = turnaround
      .map((b) => (Date.parse(b.approved_at) - Date.parse(b.created_at)) / 3600_000)
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (hrs.length > 0) {
      avgTurnaround = Math.round((hrs.reduce((a, b) => a + b, 0) / hrs.length) * 10) / 10;
    }
  }

  const metrics: BillMetrics = {
    at: new Date().toISOString(),
    queued,
    in_flight: inFlight,
    needs_review: needsReview,
    processing_failed: failed,
    posted_24h: posted24h ?? 0,
    matched_24h: matched24h ?? 0,
    oldest_needs_review_hours: oldestHours,
    avg_approval_turnaround_hours: avgTurnaround,
  };

  console.log("[bill-metrics]", JSON.stringify(metrics));
  if (failed > 0) {
    console.error(`[bill-metrics] ${failed} document(s) in processing_failed - needs attention`);
  }
  return metrics;
}
