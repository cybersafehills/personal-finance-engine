// When does the money actually run out? Pure, zero imports, deno-tested.
//
// The forecast's `projectedLow.dayOffset` is the day of the LOWEST point, which is nearly always the
// last day of the horizon - not the day the balance first goes below zero. Saying "your balance could
// dip below zero around day 30" when the money is gone in 2 days misleads, so every surface that
// warns about it uses this instead.
//
// The estimated balance is `scheduled + (usual income - usual spending) x day`: a straight line
// between dated items, with a jump at each dated item (see cash-flow-forecast.ts). Both are checked.

export type RunOutInput = {
  horizonDays: number;
  /** Checkpoints from the forecast: today, each dated item, the end. */
  points: ReadonlyArray<{ dayOffset: number; knownBalanceMinor: number }>;
  projectedEnd: { knownBalanceMinor: number; estimatedBalanceMinor: number };
};

/** Whole days until the estimated balance first goes below zero (0 = already), or null if it stays above within the horizon. */
export function runOutInDays(f: RunOutInput): number | null {
  const horizon = Math.max(1, f.horizonDays);
  const net =
    (f.projectedEnd.estimatedBalanceMinor - f.projectedEnd.knownBalanceMinor) /
    horizon;
  const cps = f.points;
  for (let i = 0; i < cps.length; i++) {
    const { dayOffset, knownBalanceMinor } = cps[i];
    if (knownBalanceMinor + net * dayOffset < 0) {
      return Math.max(0, Math.ceil(dayOffset));
    }
    const nextDay = i + 1 < cps.length ? cps[i + 1].dayOffset : dayOffset;
    if (net < 0 && nextDay > dayOffset) {
      const hitsZeroAt = -knownBalanceMinor / net;
      if (hitsZeroAt < nextDay) return Math.max(0, Math.ceil(hitsZeroAt));
    }
  }
  return null;
}

/** "right away" / "in about 1 day" / "in about 5 days". */
export function aboutDays(n: number): string {
  return n <= 0 ? "right away" : `in about ${n} ${n === 1 ? "day" : "days"}`;
}
