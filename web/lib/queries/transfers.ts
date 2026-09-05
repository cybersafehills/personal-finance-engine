import "server-only";
import { supabaseSession } from "../supabase-session-server";
import {
  findTransferCandidates,
  type TransferCandidateTransaction,
} from "../transfer-detection";

// Self-transfer detection reads. First domain slice peeled out of the
// 3k-line web/lib/queries.ts (assessment item 10): a leaf domain nothing
// else in queries.ts depends on. queries.ts re-exports these so every
// existing `from ".../lib/queries"` import keeps working.

const TRANSFER_LOOKBACK_DAYS = 60;

export type TransferCandidateDisplay = {
  outTransactionId: string;
  outAccountName: string;
  outOccurredAt: string;
  inTransactionId: string;
  inAccountName: string;
  inOccurredAt: string;
  amountMinor: number;
  currency: string;
  amountDiffPercent: number;
  hoursApart: number;
};

/**
 * Heuristic self-transfer suggestions - see web/lib/transfer-detection.ts
 * for the matching algorithm itself. Bounded to the last 60 days (not the
 * whole transaction history) and excludes any transaction already present
 * in transfer_links (linked OR dismissed) so a reviewed transaction is
 * never re-suggested.
 */
export async function getTransferCandidates(): Promise<
  TransferCandidateDisplay[]
> {
  const supabase = await supabaseSession();
  const sinceIso = new Date(
    Date.now() - TRANSFER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [txnsResult, reviewedResult] = await Promise.all([
    supabase
      .from("transactions")
      .select(
        "id, account_id, direction, currency, principal_effect_rwf, occurred_at, accounts!transactions_account_id_fkey(name)",
      )
      .in("direction", ["in", "out"])
      .eq("settlement_state", "settled")
      .gte("occurred_at", sinceIso),
    supabase.from("transfer_links").select(
      "out_transaction_id, in_transaction_id",
    ),
  ]);

  if (txnsResult.error) {
    console.error("getTransferCandidates failed:", txnsResult.error.message);
    return [];
  }
  if (reviewedResult.error) {
    console.error(
      "getTransferCandidates (reviewed) failed:",
      reviewedResult.error.message,
    );
  }

  const reviewedIds = new Set<string>();
  for (const row of reviewedResult.data ?? []) {
    reviewedIds.add(row.out_transaction_id);
    reviewedIds.add(row.in_transaction_id);
  }

  type Row = {
    id: string;
    account_id: string;
    direction: "in" | "out";
    currency: string;
    principal_effect_rwf: number | null;
    occurred_at: string;
    accounts: { name: string } | null;
  };

  const eligible = (txnsResult.data as unknown as Row[]).filter(
    (row) => !reviewedIds.has(row.id) && row.principal_effect_rwf !== null,
  );

  const forMatching: TransferCandidateTransaction[] = eligible.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    direction: row.direction,
    amountMinor: BigInt(Math.abs(row.principal_effect_rwf!)),
    occurredAt: row.occurred_at,
    currency: row.currency,
  }));

  const byId = new Map(eligible.map((row) => [row.id, row]));
  const candidates = findTransferCandidates(forMatching);

  return candidates.map((c) => {
    const out = byId.get(c.outTransactionId)!;
    const incoming = byId.get(c.inTransactionId)!;
    return {
      outTransactionId: c.outTransactionId,
      outAccountName: out.accounts?.name ?? "Unknown account",
      outOccurredAt: out.occurred_at,
      inTransactionId: c.inTransactionId,
      inAccountName: incoming.accounts?.name ?? "Unknown account",
      inOccurredAt: incoming.occurred_at,
      amountMinor: Math.abs(out.principal_effect_rwf!),
      currency: out.currency,
      amountDiffPercent: c.amountDiffPercent,
      hoursApart: c.hoursApart,
    };
  });
}

export type LinkedTransferRow = {
  id: string;
  out_transaction_id: string;
  in_transaction_id: string;
  status: "linked" | "dismissed";
  created_at: string;
};

export async function getTransferLinks(): Promise<LinkedTransferRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transfer_links")
    .select("id, out_transaction_id, in_transaction_id, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getTransferLinks failed:", error.message);
    return [];
  }

  return data ?? [];
}
