import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { linkedTransferIdSet } from "../transfer-exclusion";
import {
  buildEffectiveMap,
  type CounterpartyRef,
  resolveCounterparty,
} from "../counterparties/effective";
import type { InsightFact } from "./insights-math";

// Reads the facts the Insights core needs. Session client => RLS-scoped; the
// service role is never used. Capped so a huge range can't exhaust memory: the
// caller turns `truncated` into a 422 rather than returning wrong totals.

export const MAX_FACT_ROWS = 20_000;

type Row = {
  id: string;
  direction: "in" | "out" | "neutral";
  principal_effect_rwf: number | string | null;
  fee_effect_rwf: number | string | null;
  category: string | null;
  transaction_type: string;
  counterparty_id: string | null;
  counterparty_name: string | null;
  account_id: string | null;
  currency: string;
  settlement_state: string | null;
  occurred_at: string;
};

const COLUMNS =
  "id, direction, principal_effect_rwf, fee_effect_rwf, category, transaction_type, counterparty_id, counterparty_name, account_id, currency, settlement_state, occurred_at";

function settlement(state: string | null): InsightFact["settlement"] {
  if (state === "settled") return "settled";
  if (state === "failed" || state === "reversed") return "failed";
  return "pending"; // pending, unknown, or not yet processed: never counted
}

export async function fetchInsightFacts(
  workspaceId: string,
  from: string,
  to: string,
): Promise<{ facts: InsightFact[]; linked: Set<string>; truncated: boolean }> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .neq("dedupe_state", "merged")
    .gte("occurred_at", from)
    .lt("occurred_at", to)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAX_FACT_ROWS + 1);
  if (error) throw new Error(`fetchInsightFacts: ${error.message}`);

  const rows = (data ?? []) as Row[];
  const truncated = rows.length > MAX_FACT_ROWS;
  const kept = truncated ? rows.slice(0, MAX_FACT_ROWS) : rows;

  const { data: links, error: linkError } = await supabase
    .from("transfer_links")
    .select("out_transaction_id, in_transaction_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "linked");
  if (linkError) throw new Error(`fetchInsightFacts links: ${linkError.message}`);

  // Resolve merged counterparties to their survivors so a merge changes the
  // grouping (and the displayed name), exactly as in the counterparty list.
  const { data: cps, error: cpError } = await supabase
    .from("counterparties")
    .select("id, display_name, merged_into_id")
    .eq("workspace_id", workspaceId)
    .limit(10_000);
  if (cpError) throw new Error(`fetchInsightFacts counterparties: ${cpError.message}`);
  const effective = buildEffectiveMap((cps ?? []) as CounterpartyRef[]);

  return {
    facts: kept.map((r) => ({
      id: r.id,
      direction: r.direction,
      principalEffectRwf: Number(r.principal_effect_rwf ?? 0),
      feeEffectRwf: Number(r.fee_effect_rwf ?? 0),
      category: r.category,
      transactionType: r.transaction_type,
      ...resolveCounterparty(r.counterparty_id, r.counterparty_name, effective),
      accountId: r.account_id,
      currency: r.currency,
      settlement: settlement(r.settlement_state),
      occurredAt: r.occurred_at,
    })),
    linked: linkedTransferIdSet(links ?? []),
    truncated,
  };
}
