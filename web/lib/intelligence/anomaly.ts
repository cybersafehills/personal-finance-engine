// Release 6 (Intelligence): high-confidence amount-anomaly detection
// (assessment section 44 / ADR 0014). Pure, zero imports, deno-tested.
//
// The only anomaly this flags is a single outflow that is far larger than
// what the SAME counterparty has cost before - "you usually pay ~2,000
// here; this one was 18,000". It is deliberately narrow: a counterparty
// with a stable history and one clear outlier. It never flags a
// first-ever payment, a counterparty with volatile amounts, or a small
// absolute difference. There is no statistical model beyond the median of
// the prior payments; a user can verify it against their own ledger.

export type AnomalyCandidate = {
  /** Trimmed, lowercased counterparty - callers drop rows without one. */
  counterpartyKey: string;
  category: string | null;
  /** Outflow magnitude, positive minor units. */
  amountMinor: number;
  /** ISO timestamp. */
  occurredAt: string;
};

export type AmountAnomaly = {
  counterpartyKey: string;
  category: string | null;
  amountMinor: number;
  /** Median of that counterparty's PRIOR payments. */
  typicalMinor: number;
  /** amountMinor / typicalMinor, rounded to 1dp. */
  timesTypical: number;
  occurredAt: string;
};

export type AnomalyOptions = {
  /** Prior payments to the same counterparty required before judging. */
  minHistory: number;
  /** How many times the typical amount counts as anomalous. */
  multiple: number;
  /** Minimum absolute gap (minor units) so trivial amounts never flag. */
  minAbsoluteGapMinor: number;
  /** Only consider transactions at or after this ISO time as "recent". */
  since: string;
};

export const DEFAULT_ANOMALY_OPTIONS: Omit<AnomalyOptions, "since"> = {
  minHistory: 4,
  multiple: 3,
  minAbsoluteGapMinor: 5_000,
};

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 0
    ? (sortedAsc[mid - 1] + sortedAsc[mid]) / 2
    : sortedAsc[mid];
}

/**
 * Groups by counterparty, and for each recent (>= `since`) transaction
 * checks it against the median of that counterparty's OTHER transactions.
 * At most one anomaly per counterparty (the largest recent offender).
 */
export function detectAmountAnomalies(
  candidates: readonly AnomalyCandidate[],
  options: AnomalyOptions,
): AmountAnomaly[] {
  const byCounterparty = new Map<string, AnomalyCandidate[]>();
  for (const c of candidates) {
    const list = byCounterparty.get(c.counterpartyKey) ?? [];
    list.push(c);
    byCounterparty.set(c.counterpartyKey, list);
  }

  const anomalies: AmountAnomaly[] = [];

  for (const [key, all] of byCounterparty) {
    if (all.length <= options.minHistory) continue;

    const recent = all
      .filter((c) => c.occurredAt >= options.since)
      .sort((a, b) => b.amountMinor - a.amountMinor);
    if (recent.length === 0) continue;

    for (const tx of recent) {
      const others = all
        .filter((c) => c !== tx)
        .map((c) => c.amountMinor)
        .sort((a, b) => a - b);
      if (others.length < options.minHistory) continue;

      const typical = median(others);
      if (typical <= 0) continue;
      if (tx.amountMinor < typical * options.multiple) continue;
      if (tx.amountMinor - typical < options.minAbsoluteGapMinor) continue;

      anomalies.push({
        counterpartyKey: key,
        category: tx.category,
        amountMinor: tx.amountMinor,
        typicalMinor: Math.round(typical),
        timesTypical: Math.round((tx.amountMinor / typical) * 10) / 10,
        occurredAt: tx.occurredAt,
      });
      break; // largest recent offender only, per counterparty
    }
  }

  return anomalies.sort((a, b) =>
    b.timesTypical - a.timesTypical || b.amountMinor - a.amountMinor ||
    a.counterpartyKey.localeCompare(b.counterpartyKey)
  );
}
