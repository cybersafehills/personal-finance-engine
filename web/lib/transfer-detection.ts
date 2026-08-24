// Self-transfer candidate detection: pure, dependency-free matching logic
// for "is this pair of transactions plausibly the same money moving
// between two of the user's own accounts". Deliberately a heuristic, not
// a database-enforced rule - there is no phone-number-to-account mapping
// anywhere in this schema that could prove two transactions are actually
// the same transfer (see the Phase E migration's own note on
// transfer_links), so this only ever produces SUGGESTIONS for a human to
// confirm or dismiss (see app/transactions/transfers/actions.ts).
//
// Zero imports, unit-tested with `deno test` (see
// transfer_detection_test.ts), matching this repository's established
// pattern for pure financial/matching logic.

export type TransferCandidateTransaction = {
  id: string;
  accountId: string;
  direction: "in" | "out";
  /** Absolute magnitude in minor units - principal only (excludes fee) for an 'out' row, full received amount for an 'in' row. */
  amountMinor: bigint;
  occurredAt: string;
  currency: string;
};

export type TransferMatchOptions = {
  /** Maximum allowed relative amount difference, as a percentage of the larger amount. Default 2 - MoMo-to-MoMo transfers between a user's own accounts should land the recipient the exact principal sent. */
  amountTolerancePercent: number;
  /** Maximum time between the two transactions for them to be considered a plausible pair. Default 24. */
  maxHoursApart: number;
};

export const DEFAULT_TRANSFER_MATCH_OPTIONS: TransferMatchOptions = {
  amountTolerancePercent: 2,
  maxHoursApart: 24,
};

function hoursBetween(aIso: string, bIso: string): number {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / (60 * 60 * 1000);
}

function amountDiffPercent(a: bigint, b: bigint): number {
  const larger = a > b ? a : b;
  if (larger === 0n) return 0;
  const diff = a > b ? a - b : b - a;
  return Number((diff * 10000n) / larger) / 100;
}

/**
 * Whether an 'out' transaction and an 'in' transaction are a plausible
 * self-transfer pair: different accounts (a transfer within one account
 * makes no sense), same currency, amounts within tolerance, and close
 * enough in time.
 */
export function isPlausibleTransferPair(
  out: TransferCandidateTransaction,
  incoming: TransferCandidateTransaction,
  options: TransferMatchOptions = DEFAULT_TRANSFER_MATCH_OPTIONS,
): boolean {
  if (out.direction !== "out" || incoming.direction !== "in") return false;
  if (out.accountId === incoming.accountId) return false;
  if (out.currency !== incoming.currency) return false;
  if (amountDiffPercent(out.amountMinor, incoming.amountMinor) > options.amountTolerancePercent) {
    return false;
  }
  if (hoursBetween(out.occurredAt, incoming.occurredAt) > options.maxHoursApart) return false;
  return true;
}

export type TransferCandidatePair = {
  outTransactionId: string;
  inTransactionId: string;
  hoursApart: number;
  amountDiffPercent: number;
};

/**
 * Greedily pairs plausible out/in candidates: scores every valid pair by
 * closeness in time (ties broken by amount difference), then assigns
 * pairs best-first, skipping any pair where either side has already been
 * claimed by a better-scoring pair - so no transaction is ever suggested
 * as part of two different transfers at once, and the result is fully
 * deterministic for a given input.
 */
export function findTransferCandidates(
  transactions: TransferCandidateTransaction[],
  options: TransferMatchOptions = DEFAULT_TRANSFER_MATCH_OPTIONS,
): TransferCandidatePair[] {
  const outs = transactions.filter((t) => t.direction === "out");
  const ins = transactions.filter((t) => t.direction === "in");

  const scoredPairs: (TransferCandidatePair & { outId: string; inId: string })[] = [];

  for (const out of outs) {
    for (const incoming of ins) {
      if (!isPlausibleTransferPair(out, incoming, options)) continue;
      scoredPairs.push({
        outTransactionId: out.id,
        inTransactionId: incoming.id,
        outId: out.id,
        inId: incoming.id,
        hoursApart: hoursBetween(out.occurredAt, incoming.occurredAt),
        amountDiffPercent: amountDiffPercent(out.amountMinor, incoming.amountMinor),
      });
    }
  }

  scoredPairs.sort((a, b) => {
    if (a.hoursApart !== b.hoursApart) return a.hoursApart - b.hoursApart;
    if (a.amountDiffPercent !== b.amountDiffPercent) return a.amountDiffPercent - b.amountDiffPercent;
    return a.outId === b.outId ? a.inId.localeCompare(b.inId) : a.outId.localeCompare(b.outId);
  });

  const usedOut = new Set<string>();
  const usedIn = new Set<string>();
  const result: TransferCandidatePair[] = [];

  for (const pair of scoredPairs) {
    if (usedOut.has(pair.outId) || usedIn.has(pair.inId)) continue;
    usedOut.add(pair.outId);
    usedIn.add(pair.inId);
    result.push({
      outTransactionId: pair.outTransactionId,
      inTransactionId: pair.inTransactionId,
      hoursApart: pair.hoursApart,
      amountDiffPercent: pair.amountDiffPercent,
    });
  }

  return result;
}
