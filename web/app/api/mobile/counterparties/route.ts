import { NextRequest } from "next/server";
import { MobileApiError, mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../lib/mobile-workspace";
import { supabaseSession } from "../../../../lib/supabase-session-server";
import { groupCounterpartyRows, parseCounterpartyListParams } from "../../../../lib/counterparties/mobile";

// GET /api/mobile/counterparties - the workspace's people & merchants with
// money sent / received / net / count / first / last per currency (all-time;
// confirmed self-transfers excluded, same rules as Insights). Searchable and
// filterable by kind. Dark unless COUNTERPARTIES_ENABLED covers the workspace.
// Merge / rename / undo are the RPCs merge_counterparties, update_counterparty,
// undo_counterparty_merge and backfill_counterparties, called by the app
// directly under RLS (docs/mobile-api.md).

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "counterparties", async () => {
    const parsed = parseCounterpartyListParams(request.nextUrl.searchParams);
    if (!parsed.ok) throw new MobileApiError(400, parsed.error);
    const p = parsed.value;

    const { workspaceId } = await resolveMobileWorkspace(p.workspaceId);
    requireFlag("COUNTERPARTIES", workspaceId);

    const supabase = await supabaseSession();
    let q = supabase
      .from("counterparty_summaries_v")
      .select("*")
      .eq("workspace_id", workspaceId)
      .limit(2000);
    if (p.kind) q = q.eq("kind", p.kind);
    if (p.q) q = q.ilike("display_name", `%${p.q}%`);

    const [rows, unresolved] = await Promise.all([
      q,
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .is("counterparty_id", null)
        .neq("dedupe_state", "merged"),
    ]);
    if (rows.error) throw new Error("counterparties query failed");

    const all = groupCounterpartyRows(rows.data ?? []);
    return {
      workspace_id: workspaceId,
      total: all.length,
      limit: p.limit,
      offset: p.offset,
      // Transactions not yet resolved to a counterparty (run backfill_counterparties).
      unresolved_transactions: unresolved.count ?? 0,
      counterparties: all.slice(p.offset, p.offset + p.limit),
    };
  });
}
