import { NextRequest } from "next/server";
import { MobileApiError, mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../lib/mobile-workspace";
import { supabaseSession } from "../../../../lib/supabase-session-server";
import { parseCounterpartyListParams } from "../../../../lib/counterparties/mobile";
import { loadCounterpartyList } from "../../../../lib/counterparties/directory-data";

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
    const list = await loadCounterpartyList(supabase, workspaceId, p);
    return {
      workspace_id: workspaceId,
      total: list.total,
      limit: p.limit,
      offset: p.offset,
      // Transactions not yet resolved to a counterparty (run backfill_counterparties).
      unresolved_transactions: list.unresolvedTransactions,
      counterparties: list.counterparties,
    };
  });
}
