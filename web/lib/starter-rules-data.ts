import "server-only";
import { getLinkedTransferIds } from "./queries";
import { supabaseSession } from "./supabase-session-server";
import type { StarterTxn } from "./starter-rules";

// Reads what the starter-rule proposer needs: EVERY uncategorized transaction (not
// just the newest few hundred) and a sample of categorized ones as evidence for
// "this name is already categorized this way". Only the four columns it uses are
// selected, paged under PostgREST's 1000-row cap. Transactions that are transfers
// between the user's own accounts (confirmed links, or a counterparty marked
// "My account") are left out: a categorization rule for them is pointless.

const PAGE = 1000;
const MAX_UNCATEGORIZED = 10_000;
const MAX_EVIDENCE = 3_000;

type Row = {
  id: string;
  counterparty_name: string | null;
  direction: string;
  amount_rwf: number | null;
  category: string | null;
};

export type StarterInputs = {
  uncategorized: StarterTxn[];
  categorized: StarterTxn[];
  /** Exact count of uncategorized transactions (own-account ones excluded). */
  totalUncategorized: number;
  /** True when there were more than we read. */
  capped: boolean;
};

const toStarter = (r: Row): StarterTxn => ({
  counterpartyName: r.counterparty_name,
  direction: r.direction,
  amountRwf: Math.abs(Number(r.amount_rwf ?? 0)),
  category: r.category,
});

export async function loadStarterInputs(): Promise<StarterInputs> {
  const supabase = await supabaseSession();
  const linked = await getLinkedTransferIds(supabase);

  async function readAll(uncategorized: boolean, max: number): Promise<{ rows: Row[]; capped: boolean }> {
    const rows: Row[] = [];
    for (let offset = 0; offset < max; offset += PAGE) {
      let q = supabase
        .from("transactions")
        .select("id, counterparty_name, direction, amount_rwf, category")
        .neq("dedupe_state", "merged")
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      q = uncategorized ? q.is("category", null) : q.not("category", "is", null);
      const { data, error } = await q;
      if (error) throw new Error(`loadStarterInputs failed: ${error.message}`);
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) return { rows, capped: false };
    }
    return { rows, capped: true };
  }

  const [unc, evidence] = await Promise.all([
    readAll(true, MAX_UNCATEGORIZED),
    readAll(false, MAX_EVIDENCE),
  ]);
  const keep = (r: Row) => !linked.has(r.id);
  const uncategorized = unc.rows.filter(keep).map(toStarter);
  return {
    uncategorized,
    categorized: evidence.rows.filter(keep).map(toStarter),
    totalUncategorized: uncategorized.length,
    capped: unc.capped,
  };
}
