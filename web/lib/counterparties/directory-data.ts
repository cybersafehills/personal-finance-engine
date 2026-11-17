import "server-only";
import type { supabaseSession } from "../supabase-session-server";
import { groupCounterpartyRows, type MobileCounterparty } from "./mobile";

// The one place the People & merchants list and a person's detail are read.
// Used by BOTH /api/mobile/counterparties[/id] and the web /people pages, so
// the two surfaces can never disagree about who someone is or what they were
// sent/received (the same drift that bit the Insights loader). Session client
// => RLS-scoped; the service role is never used.

type Session = Awaited<ReturnType<typeof supabaseSession>>;

/** The people-and-merchants list never reads more than this many summary rows. */
const MAX_SUMMARY_ROWS = 2000;

export type CounterpartyList = {
  total: number;
  /** Transactions not yet resolved to a counterparty (backfill_counterparties sorts them). */
  unresolvedTransactions: number;
  counterparties: MobileCounterparty[];
};

export async function loadCounterpartyList(
  supabase: Session,
  workspaceId: string,
  p: { q: string | null; kind: string | null; limit: number; offset: number },
): Promise<CounterpartyList> {
  let q = supabase
    .from("counterparty_summaries_v")
    .select("*")
    .eq("workspace_id", workspaceId)
    .limit(MAX_SUMMARY_ROWS);
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
    total: all.length,
    unresolvedTransactions: unresolved.count ?? 0,
    counterparties: all.slice(p.offset, p.offset + p.limit),
  };
}

export type CounterpartyTransaction = {
  id: string;
  direction: string;
  transaction_type: string;
  /** Signed minor units of `currency`, as a decimal string. */
  amount_minor: string;
  currency: string;
  category: string | null;
  counterparty_name: string | null;
  account_id: string | null;
  status: string | null;
  occurred_at: string;
};

export type CounterpartyDetail = {
  counterparty: MobileCounterparty;
  mergedFrom: { id: string; display_name: string }[];
  totalTransactions: number;
  transactions: CounterpartyTransaction[];
};

export type CounterpartyDetailResult =
  | { kind: "ok"; detail: CounterpartyDetail }
  | { kind: "not_found" }
  /** Combined into another person; `into` is the survivor to open instead. */
  | { kind: "merged"; into: string };

export async function loadCounterpartyDetail(
  supabase: Session,
  workspaceId: string,
  id: string,
  page: { limit: number; offset: number },
): Promise<CounterpartyDetailResult> {
  const { data: cp } = await supabase
    .from("counterparties")
    .select("id, display_name, kind, confidence, merged_into_id")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (!cp) return { kind: "not_found" };
  // A merged counterparty resolves to its survivor.
  if (cp.merged_into_id) return { kind: "merged", into: cp.merged_into_id };

  const [summary, children] = await Promise.all([
    supabase
      .from("counterparty_summaries_v")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("counterparty_id", id),
    supabase
      .from("counterparties")
      .select("id, display_name")
      .eq("workspace_id", workspaceId)
      .eq("merged_into_id", id),
  ]);
  const ids = [id, ...(children.data ?? []).map((c) => c.id)];

  const txns = await supabase
    .from("transactions")
    .select(
      "id, direction, transaction_type, principal_effect_rwf, fee_effect_rwf, currency, category, counterparty_name, account_id, settlement_state, occurred_at",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .in("counterparty_id", ids)
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (txns.error) throw new Error("counterparty transactions query failed");

  return {
    kind: "ok",
    detail: {
      counterparty: groupCounterpartyRows(summary.data ?? [])[0] ?? {
        id: cp.id,
        display_name: cp.display_name,
        kind: cp.kind,
        confidence: cp.confidence,
        txn_count: 0,
        first_at: null,
        last_at: null,
        currencies: [],
      },
      mergedFrom: (children.data ?? []).map((c) => ({ id: c.id, display_name: c.display_name })),
      totalTransactions: txns.count ?? 0,
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
    },
  };
}
