// Recurring-payment detection: pure, dependency-free pattern matching for
// "a payment that showed up in most recent months around the same day,
// for the same counterparty, and hasn't shown up yet this month even
// though its usual day has already passed". Explicitly a heuristic
// (documented in the UI, same as transfer-detection.ts) - there is no
// concept of a recurring bill/subscription anywhere in this schema, only
// a history of individual transactions to infer a pattern from.
//
// Zero imports, unit-tested with `deno test` (see
// recurring_payments_test.ts).

export type RecurringCandidateTransaction = {
  /** Trimmed, lowercased counterparty name - callers exclude transactions with no counterparty_name entirely, since a pattern needs a stable identifier. */
  counterpartyKey: string;
  category: string | null;
  amountMinor: bigint;
  /** "YYYY-MM" */
  monthKey: string;
  dayOfMonth: number;
};

export type RecurringPattern = {
  counterpartyKey: string;
  category: string | null;
  typicalAmountMinor: bigint;
  typicalDayOfMonth: number;
  monthsSeen: number;
};

export type RecurringDetectionOptions = {
  /** Minimum number of the supplied complete months a (counterparty, category) pair must appear in to count as a pattern. Default 2. */
  minMonthsSeen: number;
  /** Amount tolerance, as a percentage of the larger amount, for two occurrences to be considered "the same" payment. Default 15 - recurring bills often vary slightly (usage-based utilities, etc). */
  amountTolerancePercent: number;
};

export const DEFAULT_RECURRING_DETECTION_OPTIONS: RecurringDetectionOptions = {
  minMonthsSeen: 2,
  amountTolerancePercent: 15,
};

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function amountsAgree(
  a: bigint,
  b: bigint,
  tolerancePercent: number,
): boolean {
  const larger = a > b ? a : b;
  if (larger === 0n) return true;
  const diff = a > b ? a - b : b - a;
  return Number((diff * 10000n) / larger) / 100 <= tolerancePercent;
}

/**
 * Groups transactions by (counterpartyKey, category) and keeps only
 * groups that appear in at least `minMonthsSeen` of the supplied
 * `completeMonthKeys`, with mutually-agreeing amounts across those
 * months (a group where the amounts vary wildly between months isn't a
 * reliable pattern, even if the counterparty recurs). `typicalAmountMinor`
 * and `typicalDayOfMonth` are the median across matched occurrences -
 * median rather than mean/mode so one unusually early/late or
 * unusually large/small occurrence doesn't skew the "usual" figure.
 */
export function detectRecurringPatterns(
  transactions: RecurringCandidateTransaction[],
  completeMonthKeys: string[],
  options: RecurringDetectionOptions = DEFAULT_RECURRING_DETECTION_OPTIONS,
): RecurringPattern[] {
  const inScope = transactions.filter((t) => completeMonthKeys.includes(t.monthKey));

  const groups = new Map<string, RecurringCandidateTransaction[]>();
  for (const t of inScope) {
    const key = `${t.counterpartyKey}::${t.category ?? ""}`;
    const existing = groups.get(key) ?? [];
    existing.push(t);
    groups.set(key, existing);
  }

  const patterns: RecurringPattern[] = [];

  for (const occurrences of groups.values()) {
    // One occurrence per month is expected for a monthly recurring
    // payment - if a month has more than one, keep only the first
    // (earliest day) to avoid a single busy month inflating monthsSeen.
    const byMonth = new Map<string, RecurringCandidateTransaction>();
    for (const occ of occurrences) {
      const existing = byMonth.get(occ.monthKey);
      if (!existing || occ.dayOfMonth < existing.dayOfMonth) {
        byMonth.set(occ.monthKey, occ);
      }
    }

    const monthlyOccurrences = Array.from(byMonth.values());
    if (monthlyOccurrences.length < options.minMonthsSeen) continue;

    // Amounts must mutually agree: every occurrence within tolerance of
    // the median amount (a single-pass check against the eventual
    // median, not full pairwise agreement - sufficient to reject a
    // clearly inconsistent group without being overly strict).
    const amounts = monthlyOccurrences.map((o) => o.amountMinor).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const medianAmount = amounts[Math.floor(amounts.length / 2)];
    const allAgree = monthlyOccurrences.every((o) =>
      amountsAgree(o.amountMinor, medianAmount, options.amountTolerancePercent)
    );
    if (!allAgree) continue;

    const days = monthlyOccurrences.map((o) => o.dayOfMonth).sort((a, b) => a - b);
    const first = monthlyOccurrences[0];

    patterns.push({
      counterpartyKey: first.counterpartyKey,
      category: first.category,
      typicalAmountMinor: medianAmount,
      typicalDayOfMonth: Math.round(median(days)),
      monthsSeen: monthlyOccurrences.length,
    });
  }

  return patterns.sort((a, b) => a.counterpartyKey.localeCompare(b.counterpartyKey));
}

export type MissingRecurringPayment = {
  counterpartyKey: string;
  category: string | null;
  typicalAmountMinor: bigint;
  typicalDayOfMonth: number;
  expectedByDayOfMonth: number;
};

/**
 * Which of the given patterns are overdue: today is past the pattern's
 * typical day plus a grace period, and no transaction matching that
 * (counterparty, category) at a comparable amount has appeared in the
 * current month yet. Grace period defaults to 5 days - avoids flagging a
 * payment that's simply posting a little later than usual this month.
 */
export function findMissingRecurringPayments(
  patterns: RecurringPattern[],
  currentMonthTransactions: RecurringCandidateTransaction[],
  todayDayOfMonth: number,
  graceDays = 5,
  amountTolerancePercent = DEFAULT_RECURRING_DETECTION_OPTIONS.amountTolerancePercent,
): MissingRecurringPayment[] {
  const missing: MissingRecurringPayment[] = [];

  for (const pattern of patterns) {
    const expectedByDayOfMonth = pattern.typicalDayOfMonth + graceDays;
    if (todayDayOfMonth <= expectedByDayOfMonth) continue;

    const alreadyOccurred = currentMonthTransactions.some((t) =>
      t.counterpartyKey === pattern.counterpartyKey &&
      t.category === pattern.category &&
      amountsAgree(t.amountMinor, pattern.typicalAmountMinor, amountTolerancePercent)
    );
    if (alreadyOccurred) continue;

    missing.push({
      counterpartyKey: pattern.counterpartyKey,
      category: pattern.category,
      typicalAmountMinor: pattern.typicalAmountMinor,
      typicalDayOfMonth: pattern.typicalDayOfMonth,
      expectedByDayOfMonth,
    });
  }

  return missing;
}
