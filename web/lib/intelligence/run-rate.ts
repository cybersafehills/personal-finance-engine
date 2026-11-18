// Run-rate estimates behind the cash-flow forecast: typical money out and
// money in per day over a recent window. PURE (no imports) so it is
// unit-tested with `deno test`.
//
// Three rules keep the forecast honest, each one a bug the first version had:
//  1. Both sides. A forecast that subtracts spending but never adds money in
//     always ends below zero for anyone who is paid.
//  2. Your own wallet-to-wallet transfers are neither spending nor income
//     (confirmed transfer legs are passed in `linked` and skipped).
//  4. One-off windfalls are not income you can plan on. With enough receipts
//     to know what "typical" is, any single receipt more than `windfallFactor`
//     times the median receipt is left out of the rate (and counted, so the
//     forecast can say so).
//  3. Divide by the days actually observed. The caller only reads the newest N
//     transactions; if that cut off the window, dividing by the full window
//     (say 90 days) understates both rates.

export type RateTxn = {
  id: string;
  direction: "in" | "out";
  /** Positive minor units: what moved (fee included for money out). */
  amountMinor: number;
  occurredAt: string;
  /** Recurring-payment key; those are scheduled separately, never "everyday" spend. */
  recurringKey: string | null;
};

export type RateOptions = {
  windowDays: number;
  nowMs: number;
  linked: ReadonlySet<string>;
  recurringKeys: ReadonlySet<string>;
  /** True when the read hit its row cap, so older rows may be missing. */
  truncated: boolean;
  /** Fewer than this many money-out rows and the spending rate is not trusted. */
  minOut?: number;
  /** Fewer than this many money-in rows and the income rate is not trusted. */
  minIn?: number;
  /** Fewer observed days than this and neither rate is trusted. */
  minObservedDays?: number;
  /** A receipt above this many times the median receipt is a windfall. Default 3. */
  windfallFactor?: number;
  /** Fewer receipts than this and nothing is called a windfall. Default 5. */
  minForWindfall?: number;
};

export type DailyRates = {
  dailyOutMinor: number;
  dailyInMinor: number;
  observedDays: number;
  outCount: number;
  inCount: number;
  /** Receipts left out of dailyInMinor as one-offs (they are not in inCount). */
  windfallCount: number;
};

const DAY_MS = 86_400_000;

export function estimateDailyRates(
  txns: readonly RateTxn[],
  o: RateOptions,
): DailyRates {
  const minOut = o.minOut ?? 10;
  const minIn = o.minIn ?? 3;
  const minDays = o.minObservedDays ?? 21;
  const windfallFactor = o.windfallFactor ?? 3;
  const minForWindfall = o.minForWindfall ?? 5;
  const cutoff = o.nowMs - o.windowDays * DAY_MS;

  let oldest = Infinity;
  for (const t of txns) {
    const ms = Date.parse(t.occurredAt);
    if (Number.isFinite(ms) && ms < oldest) oldest = ms;
  }
  // Rows older than the window still say how far back the read reached.
  const reach = Number.isFinite(oldest)
    ? Math.max(1, Math.ceil((o.nowMs - oldest) / DAY_MS))
    : 0;
  const observedDays = o.truncated
    ? Math.min(o.windowDays, reach)
    : o.windowDays;

  let out = 0, outCount = 0;
  const receipts: number[] = [];
  for (const t of txns) {
    const ms = Date.parse(t.occurredAt);
    if (!Number.isFinite(ms) || ms < cutoff || ms > o.nowMs) continue;
    if (o.linked.has(t.id)) continue;
    if (t.direction === "out") {
      if (t.recurringKey !== null && o.recurringKeys.has(t.recurringKey)) {
        continue;
      }
      out += t.amountMinor;
      outCount++;
    } else {
      receipts.push(t.amountMinor);
    }
  }

  // Windfalls: only judged once there are enough receipts to know "typical".
  let inn = 0, inCount = 0, windfallCount = 0;
  let ceiling = Infinity;
  if (receipts.length >= minForWindfall) {
    const sorted = [...receipts].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
    ceiling = median * windfallFactor;
  }
  for (const r of receipts) {
    if (r > ceiling) windfallCount++;
    else {
      inn += r;
      inCount++;
    }
  }

  const trusted = observedDays >= minDays;
  return {
    dailyOutMinor: trusted && outCount >= minOut
      ? Math.round(out / observedDays)
      : 0,
    dailyInMinor: trusted && inCount >= minIn
      ? Math.round(inn / observedDays)
      : 0,
    observedDays,
    outCount,
    inCount,
    windfallCount,
  };
}
