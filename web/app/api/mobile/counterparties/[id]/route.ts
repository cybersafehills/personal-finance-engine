import { NextRequest } from "next/server";
import { MobileApiError, mobileGet, mobileOptions } from "../../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../../lib/mobile-workspace";
import { supabaseSession } from "../../../../../lib/supabase-session-server";
import { groupCounterpartyRows, parsePageParams } from "../../../../../lib/counterparties/mobile";

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
    const { data: cp } = await supabase
      .from("counterparties")
      .select("id, display_name, kind, confidence, merged_into_id")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (!cp) throw new MobileApiError(404, "not_found");
    // A merged counterparty resolves to its survivor: tell the app where it went.
    if (cp.merged_into_id) {
      throw new MobileApiError(409, "merged_into:" + cp.merged_into_id);
    }

    const [summary, children] = await Promise.all([
      supabase.from("counterparty_summaries_v").select("*").eq("workspace_id", workspaceId).eq("counterparty_id", id),
      supabase.from("counterparties").select("id, display_name").eq("workspace_id", workspaceId).eq("merged_into_id", id),
    ]);
    const ids = [id, ...(children.data ?? []).map((c) => c.id)];

    const txns = await supabase
      .from("transactions")
      .select("id, direction, transaction_type, principal_effect_rwf, fee_effect_rwf, currency, category, counterparty_name, account_id, settlement_state, occurred_at", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .in("counterparty_id", ids)
      .neq("dedupe_state", "merged")
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page.value.offset, page.value.offset + page.value.limit - 1);
    if (txns.error) throw new Error("counterparty transactions query failed");

    return {
      workspace_id: workspaceId,
      counterparty: groupCounterpartyRows(summary.data ?? [])[0] ?? {
        id: cp.id,
        display_name: cp.display_name,
        kind: cp.kind,
        confidence: cp.confidence,
        currencies: [],
      },
      merged_from: (children.data ?? []).map((c) => ({ id: c.id, display_name: c.display_name })),
      total_transactions: txns.count ?? 0,
      limit: page.value.limit,
      offset: page.value.offset,
      transactions: (txns.data ?? []).map((t) => ({
        id: t.id,
        direction: t.direction,
        transaction_type: t.transaction_type,
        amount_minor: String(Number(t.principal_effect_rwf ?? 0) + Number(t.fee_effect_rwf ?? 0)),
        currency: t.currency,
        category: t.category,
        counterparty_name: t.counterparty_name,
        account_id: t.account_id,
        status: t.settlement_state,
        occurred_at: t.occurred_at,
      })),
    };
  });
}
