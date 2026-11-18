import { kindForMobile } from "../../../../../lib/counterparties/directory";
import { NextRequest } from "next/server";
import { MobileApiError, mobileGet, mobileOptions } from "../../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../../lib/mobile-workspace";
import { supabaseSession } from "../../../../../lib/supabase-session-server";
import { parsePageParams } from "../../../../../lib/counterparties/mobile";
import { loadCounterpartyDetail } from "../../../../../lib/counterparties/directory-data";

// GET /api/mobile/counterparties/{id} - one (post-merge) counterparty: its
// per-currency totals, what was merged into it, and its transactions (paged).
// Transactions are never sensitive-token bearing here: only the list fields.

export const OPTIONS = mobileOptions;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return mobileGet(request, "counterparty-detail", async () => {
    const { id } = await params;
    if (!UUID.test(id)) throw new MobileApiError(404, "not_found");
    const page = parsePageParams(request.nextUrl.searchParams);
    if (!page.ok) throw new MobileApiError(400, page.error);

    const { workspaceId } = await resolveMobileWorkspace(
      request.nextUrl.searchParams.get("workspace_id"),
    );
    requireFlag("COUNTERPARTIES", workspaceId);

    const supabase = await supabaseSession();
    const res = await loadCounterpartyDetail(supabase, workspaceId, id, page.value);
    if (res.kind === "not_found") throw new MobileApiError(404, "not_found");
    // A merged counterparty resolves to its survivor: tell the app where it went.
    if (res.kind === "merged") throw new MobileApiError(409, "merged_into:" + res.into);

    const d = res.detail;
    return {
      workspace_id: workspaceId,
      counterparty: { ...d.counterparty, kind: kindForMobile(d.counterparty.kind) },
      merged_from: d.mergedFrom,
      total_transactions: d.totalTransactions,
      limit: page.value.limit,
      offset: page.value.offset,
      transactions: d.transactions,
    };
  });
}
