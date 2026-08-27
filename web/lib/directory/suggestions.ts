import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { assertDirectoryAdmin } from "../pay/directory-perms";

// Admin reads for the moderation queue (P4). RLS already limits a
// non-`directory.resolve_reports` / non-`view_admin` caller to their own
// rows, so assertDirectoryAdmin() here is just a fast, friendly gate.

export type SuggestionRow = {
  id: string;
  suggestion_type: string;
  status: string;
  payment_network_slug: string | null;
  institution_name: string | null;
  channel: string | null;
  device: string | null;
  last_tested_date: string | null;
  body: string;
  resolution_note: string | null;
  created_at: string;
};

export type ReportAggregate = {
  targetType: "service_code" | "access_route";
  targetId: string;
  targetLabel: string;
  openCount: number;
};

export async function listDirectorySuggestions(): Promise<{
  open: SuggestionRow[];
  resolved: SuggestionRow[];
}> {
  await assertDirectoryAdmin();
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("directory_suggestions")
    .select(
      "id, suggestion_type, status, payment_network_slug, institution_name, channel, device, last_tested_date, body, resolution_note, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as SuggestionRow[];
  const openStatuses = new Set(["open", "reviewing", "needs_more_info"]);
  return {
    open: rows.filter((r) => openStatuses.has(r.status)),
    resolved: rows.filter((r) => !openStatuses.has(r.status)),
  };
}

export async function getOpenReportAggregates(): Promise<ReportAggregate[]> {
  await assertDirectoryAdmin();
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("service_code_reports")
    .select(
      "service_code_id, access_route_id, service_code:service_codes(display_name_en), route:access_routes(display_name_en)",
    )
    .in("status", ["open", "reviewing"]);

  const byKey = new Map<string, ReportAggregate>();
  for (const r of (data ?? []) as unknown as {
    service_code_id: string | null;
    access_route_id: string | null;
    service_code: { display_name_en: string } | null;
    route: { display_name_en: string } | null;
  }[]) {
    const targetType: "service_code" | "access_route" = r.service_code_id
      ? "service_code"
      : "access_route";
    const targetId = (r.service_code_id ?? r.access_route_id)!;
    const key = `${targetType}:${targetId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.openCount += 1;
    } else {
      byKey.set(key, {
        targetType,
        targetId,
        targetLabel:
          r.service_code?.display_name_en ?? r.route?.display_name_en ?? targetId,
        openCount: 1,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.openCount - a.openCount);
}
