// Deterministic statement calculation engine (Financial Documents Engine,
// Statements family - PR2). Every monetary figure a statement shows comes
// from here; the PDF/CSV renderers (PR4) and the UI (PR5) only format what
// this returns. Zero imports, zero DB access - unit-tested with
// `deno test`, matching report-math.ts / money.ts / budget-math.ts.
//
// This module NEVER re-derives the canonical accounting effect
// (supabase/functions/_shared/accounting.ts stays canonical). It consumes
// facts whose principal/fee effects are already computed, and whose
// selection (settlement_state = 'settled', dedupe_state <> 'merged',
// workspace/source scoping) is the generation layer's job (PR3), exactly
// as report-math.ts consumes report-generation.ts's facts.
//
// Amounts are plain `number` minor units. The ledger is RWF (zero-decimal)
// in practice, so a minor unit is one whole RWF and values stay far inside
// Number.MAX_SAFE_INTEGER; the type name keeps the door open for a future
// multi-currency ledger without a rename.
//
// Honesty rules (master prompt sections 14 / 15 / 23 / 31):
//   * opening / closing balances are INPUTS resolved by the generation
//     layer from the provider-reported balance column; this module never
//     invents one. `null` in means `null` out - rendered as a dash.
//   * a running-balance column is produced only from a real basis
//     (provider balances on every row, or accumulation from a known
//     opening); the basis is disclosed on the result.
//   * currencies are never summed together. Multi-currency facts yield a
//     per-currency breakdown and null top-level totals.

export type StatementFactDirection = "in" | "out" | "neutral";

/** The minimal shape this module needs from one settled transaction. */
export type StatementTransactionFact = {
  id: string;
  /** ISO 8601 instant. */
  occurredAt: string;
  direction: StatementFactDirection;
  /** Signed, already computed by the accounting engine (>= 0 for `in`, <= 0 for `out`). */
  principalEffectMinor: number;
  /** Signed fee movement, <= 0, already computed by the accounting engine. */
  feeEffectMinor: number;
  /** Provider-reported balance immediately after this transaction, or null. */
  balanceAfterMinor: number | null;
  /** ISO 4217 code, e.g. "RWF". */
  currency: string;
};

export type StatementCurrencyTotals = {
  currency: string;
  /** null = could not be established from available history (never a computed zero). */
  openingBalanceMinor: number | null;
  closingBalanceMinor: number | null;
  /** Sum of principal for `in` rows (>= 0). */
  totalCreditsMinor: number;
  /** Sum of |principal| for `out` rows (>= 0). */
  totalDebitsMinor: number;
  /** Sum of |fee| across all rows (>= 0). */
  totalFeesMinor: number;
  /** Sum of (principal + fee) across all rows (signed). */
  netMovementMinor: number;
  transactionCount: number;
  /**
   * opening + credits - debits - fees === closing, when both balances are
   * known. null = not checkable. false = checked and it did NOT balance
   * (the document still generates but is flagged, and the mismatch is
   * logged - master prompt sections 14 / 43).
   */
  reconciles: boolean | null;
};

export type StatementRunningBalanceBasis =
  | "provider"
  | "derived"
  | "unavailable";

export type StatementMathRow = {
  factId: string;
  occurredAt: string;
  /** Balance after this row, or null when no basis exists for the whole period. */
  runningBalanceMinor: number | null;
};

export type StatementMathResult = {
  /** The single currency of every fact, or null when facts span more than one. */
  currency: string | null;
  /** Present iff `currency` is non-null. */
  totals: StatementCurrencyTotals | null;
  /** One entry per distinct currency, sorted by code. Always populated when there is at least one fact or a `currency` hint. */
  perCurrency: StatementCurrencyTotals[];
  /** Facts in document order: occurredAt asc, then id asc. */
  rows: StatementMathRow[];
  runningBalanceBasis: StatementRunningBalanceBasis;
  runningBalancesResolved: boolean;
  mixedCurrency: boolean;
};

export type StatementMathOptions = {
  /** Provider-reported balance strictly before the period start. */
  openingBalanceMinor?: number | null;
  /** Provider-reported balance at/just before the period end. */
  closingBalanceMinor?: number | null;
  /**
   * Currency to report when `facts` is empty (a zero-transaction
   * statement) - taken from the selected source(s) by the caller.
   */
  currency?: string | null;
};

type Aggregate = {
  totalCreditsMinor: number;
  totalDebitsMinor: number;
  totalFeesMinor: number;
  netMovementMinor: number;
  transactionCount: number;
};

function aggregate(facts: StatementTransactionFact[]): Aggregate {
  let totalCreditsMinor = 0;
  let totalDebitsMinor = 0;
  let totalFeesMinor = 0;
  let netMovementMinor = 0;

  for (const f of facts) {
    const principal = f.principalEffectMinor;
    const fee = f.feeEffectMinor;
    totalFeesMinor += Math.abs(fee);
    netMovementMinor += principal + fee;
    if (f.direction === "in") {
      totalCreditsMinor += Math.abs(principal);
    } else if (f.direction === "out") {
      totalDebitsMinor += Math.abs(principal);
    }
  }

  return {
    totalCreditsMinor,
    totalDebitsMinor,
    totalFeesMinor,
    netMovementMinor,
    transactionCount: facts.length,
  };
}

function reconcileFlag(
  openingBalanceMinor: number | null,
  closingBalanceMinor: number | null,
  agg: Aggregate,
): boolean | null {
  if (openingBalanceMinor === null || closingBalanceMinor === null) return null;
  const expected = openingBalanceMinor + agg.totalCreditsMinor -
    agg.totalDebitsMinor - agg.totalFeesMinor;
  return expected === closingBalanceMinor;
}

function sortChronologically(
  facts: StatementTransactionFact[],
): StatementTransactionFact[] {
  return [...facts].sort((a, b) => {
    if (a.occurredAt < b.occurredAt) return -1;
    if (a.occurredAt > b.occurredAt) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

export function computeStatementMath(
  facts: StatementTransactionFact[],
  options: StatementMathOptions = {},
): StatementMathResult {
  const sorted = sortChronologically(facts);
  const currencies = Array.from(new Set(sorted.map((f) => f.currency))).sort();

  const opening = options.openingBalanceMinor ?? null;
  const closing = options.closingBalanceMinor ?? null;

  // --- Multi-currency: per-currency breakdown only, no balances, no
  // running column (master prompt section 23 - never combine currencies).
  if (currencies.length > 1) {
    const perCurrency = currencies.map((currency) => {
      const agg = aggregate(sorted.filter((f) => f.currency === currency));
      const totals: StatementCurrencyTotals = {
        currency,
        openingBalanceMinor: null,
        closingBalanceMinor: null,
        ...agg,
        reconciles: null,
      };
      return totals;
    });
    return {
      currency: null,
      totals: null,
      perCurrency,
      rows: sorted.map((f) => ({
        factId: f.id,
        occurredAt: f.occurredAt,
        runningBalanceMinor: null,
      })),
      runningBalanceBasis: "unavailable",
      runningBalancesResolved: false,
      mixedCurrency: true,
    };
  }

  // --- Single currency (the common case) or empty.
  const currency = currencies.length === 1
    ? currencies[0]
    : (options.currency ?? null);
  const agg = aggregate(sorted);

  // Running-balance basis: prefer the provider's own balance on every row;
  // otherwise accumulate from a known opening; otherwise none.
  const everyRowHasProviderBalance = sorted.length > 0 &&
    sorted.every((f) => f.balanceAfterMinor !== null);

  let basis: StatementRunningBalanceBasis;
  let rows: StatementMathRow[];

  if (everyRowHasProviderBalance) {
    basis = "provider";
    rows = sorted.map((f) => ({
      factId: f.id,
      occurredAt: f.occurredAt,
      runningBalanceMinor: f.balanceAfterMinor,
    }));
  } else if (opening !== null) {
    basis = "derived";
    let running = opening;
    rows = sorted.map((f) => {
      running += f.principalEffectMinor + f.feeEffectMinor;
      return {
        factId: f.id,
        occurredAt: f.occurredAt,
        runningBalanceMinor: running,
      };
    });
  } else {
    basis = "unavailable";
    rows = sorted.map((f) => ({
      factId: f.id,
      occurredAt: f.occurredAt,
      runningBalanceMinor: null,
    }));
  }

  const totals: StatementCurrencyTotals | null = currency === null ? null : {
    currency,
    openingBalanceMinor: opening,
    closingBalanceMinor: closing,
    ...agg,
    reconciles: reconcileFlag(opening, closing, agg),
  };

  return {
    currency,
    totals,
    perCurrency: totals ? [totals] : [],
    rows,
    runningBalanceBasis: basis,
    runningBalancesResolved: basis !== "unavailable",
    mixedCurrency: false,
  };
}
