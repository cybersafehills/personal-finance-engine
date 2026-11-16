import { supabase } from "@/api/supabase";

// The duplicate-resolution trail on a transaction, ported from the web's
// getTransactionDuplicateContext (web/lib/queries.ts). Read-only: like the web's
// detail page this only shows the trail and links to where it is resolved (the
// review queue, which the app has in the Inbox, with both candidates side by
// side); it does not merge or dismiss from here.

export type DuplicateContext = {
  dedupeState: "unique" | "possible_duplicate" | "confirmed_duplicate" | "merged";
  /** Set when this transaction was itself merged away: the one it was folded into. */
  mergedInto: { id: string; occurredAt: string; counterparty: string | null } | null;
  /** Rows merged INTO this one: kept as evidence, left out of every total. */
  mergedDuplicates: { id: string; occurredAt: string; counterparty: string | null; source: string }[];
};

export async function getDuplicateContext(id: string): Promise<DuplicateContext | null> {
  if (!supabase) return null;
  const { data: self, error } = await supabase
    .from("transactions")
    .select("dedupe_state, merged_into_transaction_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !self) return null;
  const row = self as unknown as {
    dedupe_state: DuplicateContext["dedupeState"];
    merged_into_transaction_id: string | null;
  };

  let mergedInto: DuplicateContext["mergedInto"] = null;
  if (row.merged_into_transaction_id) {
    const { data: canon } = await supabase
      .from("transactions")
      .select("id, occurred_at, counterparty_name")
      .eq("id", row.merged_into_transaction_id)
      .maybeSingle();
    if (canon) {
      const c = canon as unknown as { id: string; occurred_at: string; counterparty_name: string | null };
      mergedInto = { id: c.id, occurredAt: c.occurred_at, counterparty: c.counterparty_name };
    }
  }

  const { data: dups } = await supabase
    .from("transactions")
    .select("id, occurred_at, counterparty_name, source")
    .eq("merged_into_transaction_id", id)
    .order("occurred_at", { ascending: true });

  const mergedDuplicates = ((dups ?? []) as unknown as {
    id: string;
    occurred_at: string;
    counterparty_name: string | null;
    source: string;
  }[]).map((d) => ({
    id: d.id,
    occurredAt: d.occurred_at,
    counterparty: d.counterparty_name,
    source: d.source,
  }));

  return { dedupeState: row.dedupe_state, mergedInto, mergedDuplicates };
}

const SOURCE_LABELS: Record<string, string> = {
  mtn_momo: "MTN MoMo",
  manual: "Manual entry",
  statement: "Imported statement",
};

export const duplicateSourceLabel = (source: string): string => SOURCE_LABELS[source] ?? source;

/** Whether the Duplicates card has anything to say (the web renders nothing otherwise). */
export function hasDuplicateTrail(ctx: DuplicateContext | null): boolean {
  if (!ctx) return false;
  return (
    ctx.dedupeState === "possible_duplicate" ||
    (ctx.dedupeState === "merged" && ctx.mergedInto !== null) ||
    ctx.mergedDuplicates.length > 0
  );
}

export function mergedCountSentence(count: number): string {
  return count === 1
    ? "1 duplicate was merged into this transaction"
    : `${count} duplicates were merged into this transaction`;
}
