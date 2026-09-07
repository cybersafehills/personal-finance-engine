// Statement source & coverage disclosure (Financial Documents Engine,
// Statements family - PR2). A OneLedger statement is built from whatever
// the platform captured - SMS/notification ingestion, imports, manual
// entry - NOT an authoritative provider ledger, so every document must say
// where its data came from and flag anything that looks like a gap
// (master prompt sections 15 / 16).
//
// Zero imports, zero DB access - `deno test`. Deliberately conservative:
// the absence of a detected gap is reported as "no gap detected", never as
// a guarantee of completeness.

export type StatementCoverageFact = {
  /** ISO 8601 instant. */
  occurredAt: string;
  /**
   * The account (financial_sources id) this line belongs to. A
   * consolidated statement interleaves several accounts, each with its
   * own running balance; the balance-discontinuity check groups by this
   * so it never compares one account's balance against another's. May be
   * null for legacy source-less rows.
   */
  sourceId?: string | null;
  principalEffectMinor: number;
  feeEffectMinor: number;
  /** Provider-reported balance after this transaction, or null. */
  balanceAfterMinor: number | null;
};

export type StatementSourceDescriptor = {
  id: string;
  /** financial_sources.provider */
  provider: string;
  /** financial_sources.source_type */
  sourceType: string;
  displayName: string;
  /** Never a full account/phone number (financial_sources.masked_identifier). */
  maskedIdentifier: string | null;
};

export type CoverageWarning =
  | {
    kind: "possible_gap";
    fromIso: string;
    toIso: string;
    detail: string;
  }
  | {
    kind: "balance_discontinuity";
    atIso: string;
    detail: string;
  }
  | {
    kind: "no_balance_data";
    detail: string;
  };

export type StatementSourceMetadata = {
  sources: Array<{
    id: string;
    provider: string;
    displayName: string;
    maskedIdentifier: string | null;
    dataSourceLabel: string;
  }>;
  /** One-line summary for the document's "Data source" line. */
  summaryLabel: string;
};

export type StatementCoverageMetadata = {
  /** true only when no possible gap or balance discontinuity was detected - NOT a completeness guarantee. */
  complete: boolean;
  /** Sentence for the document's "Coverage" line. */
  statementLabel: string;
  warnings: CoverageWarning[];
  /** true when a scope-narrowing filter was applied (the document must show this). */
  filtered: boolean;
  filterSummary: string | null;
};

export type StatementCoverageInput = {
  /** Any order; sorted internally. */
  facts: StatementCoverageFact[];
  sources: StatementSourceDescriptor[];
  /** Scope-narrowing filters applied to the statement, if any. */
  filters?: {
    direction?: "in" | "out";
    category?: string;
    merchant?: string;
    participantUserId?: string;
    tag?: string;
  };
};

// An interior gap between two consecutive transactions is only flagged
// when it is both absolutely long AND far out of line with this account's
// own rhythm - keeps quiet, low-activity accounts from being flagged.
const GAP_MIN_DAYS = 21;
const GAP_MEDIAN_MULTIPLE = 5;
// An account needs at least this many balance-bearing rows before a
// balance mismatch is trustworthy enough to flag - a handful of stray
// provider balances in an otherwise balance-less account is noise, not a
// signal.
const MIN_BALANCE_ROWS_FOR_DISCONTINUITY = 3;

const PROVIDER_NOUNS: Record<string, string> = {
  mtn_momo: "MTN Mobile Money",
  airtel_money: "Airtel Money",
  bank: "Bank account",
  card: "Card",
  cash: "Cash",
  statement: "Imported statement",
};

export function dataSourceLabelForProvider(provider: string): string {
  switch (provider) {
    case "mtn_momo":
      return "MTN Mobile Money activity captured by OneLedger";
    case "airtel_money":
      return "Airtel Money activity captured by OneLedger";
    case "bank":
      return "Bank account activity recorded in OneLedger";
    case "card":
      return "Card activity recorded in OneLedger";
    case "cash":
      return "Cash activity recorded manually in OneLedger";
    case "statement":
      return "Activity imported from an uploaded statement";
    default:
      return "Financial activity recorded in OneLedger";
  }
}

function summariseSources(
  sources: StatementSourceDescriptor[],
): string {
  if (sources.length === 0) {
    return "Financial activity recorded in OneLedger";
  }
  if (sources.length === 1) {
    return dataSourceLabelForProvider(sources[0].provider);
  }
  const providers = Array.from(new Set(sources.map((s) => s.provider)));
  if (providers.length === 1) {
    const noun = PROVIDER_NOUNS[providers[0]] ?? "Financial";
    return `${noun} activity across ${sources.length} accounts, recorded in OneLedger`;
  }
  return `Activity across ${sources.length} accounts and multiple providers, recorded in OneLedger`;
}

export function buildStatementSourceMetadata(
  sources: StatementSourceDescriptor[],
): StatementSourceMetadata {
  return {
    sources: sources.map((s) => ({
      id: s.id,
      provider: s.provider,
      displayName: s.displayName,
      maskedIdentifier: s.maskedIdentifier,
      dataSourceLabel: dataSourceLabelForProvider(s.provider),
    })),
    summaryLabel: summariseSources(sources),
  };
}

function diffDays(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function filterSummaryText(
  filters: StatementCoverageInput["filters"],
): string | null {
  const parts: string[] = [];
  if (filters?.direction === "out") parts.push("Money Out only");
  else if (filters?.direction === "in") parts.push("Money In only");
  if (filters?.category) parts.push(`Category: ${filters.category}`);
  if (filters?.merchant) parts.push(`Merchant matches "${filters.merchant}"`);
  if (filters?.participantUserId) parts.push("One member's transactions");
  if (filters?.tag) parts.push(`Tag: ${filters.tag}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function deriveCoverageWarnings(
  facts: StatementCoverageFact[],
): CoverageWarning[] {
  if (facts.length === 0) return [];

  const sorted = [...facts].sort((a, b) => {
    if (a.occurredAt < b.occurredAt) return -1;
    if (a.occurredAt > b.occurredAt) return 1;
    return 0;
  });

  const warnings: CoverageWarning[] = [];

  const withBalance = sorted.filter((f) => f.balanceAfterMinor !== null);
  if (withBalance.length === 0) {
    warnings.push({
      kind: "no_balance_data",
      detail:
        "This data source does not report running balances, so opening, closing and per-line balances are not shown.",
    });
  }

  // Interior gaps.
  if (sorted.length >= 4) {
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(diffDays(sorted[i - 1].occurredAt, sorted[i].occurredAt));
    }
    const med = median(gaps);
    for (let i = 1; i < sorted.length; i++) {
      const gap = gaps[i - 1];
      if (
        gap >= GAP_MIN_DAYS && med > 0 && gap > med * GAP_MEDIAN_MULTIPLE
      ) {
        warnings.push({
          kind: "possible_gap",
          fromIso: sorted[i - 1].occurredAt,
          toIso: sorted[i].occurredAt,
          detail: `No transactions were captured for ${
            Math.round(gap)
          } days, well outside this account's usual pattern - OneLedger may not have received every transaction in this window.`,
        });
      }
    }
  }

  // Balance discontinuities: the provider balance moved by more than the
  // transaction between two consecutive rows explains. This is only
  // meaningful WITHIN a single account - a consolidated statement
  // interleaves several independent running-balance series, so comparing
  // one account's balance against the next line's (different) account is
  // nonsense and would flag a "discontinuity" on every account switch.
  // Group by source, check each group in isolation, and report the whole
  // statement's discontinuities as ONE summarised note rather than one
  // identical line per occurrence.
  const bySource = new Map<string, StatementCoverageFact[]>();
  for (const f of sorted) {
    const key = f.sourceId ?? " unsourced";
    const list = bySource.get(key);
    if (list) list.push(f);
    else bySource.set(key, [f]);
  }

  let discontinuities = 0;
  let firstDiscontinuityIso: string | null = null;
  for (const group of bySource.values()) {
    const withBalanceInGroup = group.filter((f) =>
      f.balanceAfterMinor !== null
    );
    if (withBalanceInGroup.length < MIN_BALANCE_ROWS_FOR_DISCONTINUITY) {
      continue;
    }
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1];
      const curr = group[i];
      if (prev.balanceAfterMinor === null || curr.balanceAfterMinor === null) {
        continue;
      }
      const expected = prev.balanceAfterMinor +
        (curr.principalEffectMinor + curr.feeEffectMinor);
      if (expected !== curr.balanceAfterMinor) {
        discontinuities++;
        if (firstDiscontinuityIso === null) {
          firstDiscontinuityIso = curr.occurredAt;
        }
      }
    }
  }
  if (discontinuities > 0 && firstDiscontinuityIso !== null) {
    warnings.push({
      kind: "balance_discontinuity",
      atIso: firstDiscontinuityIso,
      detail: discontinuities === 1
        ? "At one point the recorded balance moved by more than the transaction on that line explains - a transaction may not have reached OneLedger."
        : `At ${discontinuities} points the recorded balance moved by more than the transaction on that line explains - some transactions may not have reached OneLedger.`,
    });
  }

  return warnings;
}

export function buildStatementCoverageMetadata(
  input: StatementCoverageInput,
): { source: StatementSourceMetadata; coverage: StatementCoverageMetadata } {
  const warnings = deriveCoverageWarnings(input.facts);
  const hasGapSignal = warnings.some(
    (w) => w.kind === "possible_gap" || w.kind === "balance_discontinuity",
  );
  const filterSummary = filterSummaryText(input.filters);

  return {
    source: buildStatementSourceMetadata(input.sources),
    coverage: {
      complete: !hasGapSignal,
      statementLabel: hasGapSignal
        ? "OneLedger has the transactions listed below for this period, but one or more possible gaps were detected - see the coverage notes."
        : "Complete for the financial records available to OneLedger for this account and period.",
      warnings,
      filtered: filterSummary !== null,
      filterSummary,
    },
  };
}
