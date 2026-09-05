// Release 6 (Intelligence): a deterministic, transparent cash-flow
// forecast (assessment section 46 / ADR 0014). Zero imports so it is
// unit-tested with `deno test`.
//
// It projects the balance forward over a horizon and keeps the two halves
// separate at every point:
//
//   KNOWN / SCHEDULED  = today's verified balance
//                        + dated recurring inflows/outflows
//                        + known bill due dates
//   ESTIMATED          = KNOWN minus a flat daily discretionary rate
//                        derived from spending history
//
// The estimated path is never presented as a guaranteed outcome. Every
// output carries a `basis` list so the UI can answer "Why am I seeing
// this?" with the actual inputs.

export type ScheduledMovement = {
  /** Customer-facing, e.g. "Rent", "Salary", "MTN bill". */
  label: string;
  /** Whole days from today (0 = today). Only >= 0 within the horizon are used. */
  dayOffset: number;
  /** Signed minor units: positive = money in, negative = money out. */
  amountMinor: number;
  kind: "recurring_inflow" | "recurring_outflow" | "bill_due";
  confidence: "high" | "medium";
};

export type CashFlowForecastInput = {
  currentBalanceMinor: number;
  currency: string;
  horizonDays: number;
  scheduled: ScheduledMovement[];
  /**
   * Flat estimated everyday (discretionary) OUTFLOW per day, as a
   * positive minor-unit number, from spending history. 0 disables the
   * estimated path (it then equals the known path).
   */
  estimatedDailyDiscretionaryMinor: number;
};

export type ForecastPoint = {
  dayOffset: number;
  label: string;
  knownBalanceMinor: number;
  estimatedBalanceMinor: number;
};

export type CashFlowForecast = {
  horizonDays: number;
  currency: string;
  openingBalanceMinor: number;
  /** Checkpoints: today, each scheduled-movement day, and the horizon end. */
  points: ForecastPoint[];
  scheduledInMinor: number;
  scheduledOutMinor: number;
  estimatedOutMinor: number;
  /** Lowest point the ESTIMATED path reaches over the horizon. */
  projectedLow: {
    dayOffset: number;
    knownBalanceMinor: number;
    estimatedBalanceMinor: number;
  };
  projectedEnd: { knownBalanceMinor: number; estimatedBalanceMinor: number };
  /** Whether the estimated path dips below zero within the horizon. */
  mayGoNegative: boolean;
  /** Human-readable inputs for "Why am I seeing this?". */
  basis: string[];
  disclaimer: string;
};

const DISCLAIMER =
  "Scheduled items are dated commitments from your history and bills. " +
  "The rest is an estimate based on recent spending, not a guaranteed outcome.";

export function computeCashFlowForecast(
  input: CashFlowForecastInput,
): CashFlowForecast {
  const horizon = Math.max(0, Math.floor(input.horizonDays));
  const dailyEstimate = Math.max(
    0,
    Math.round(input.estimatedDailyDiscretionaryMinor),
  );

  const inHorizon = input.scheduled
    .filter((m) => m.dayOffset >= 0 && m.dayOffset <= horizon)
    .sort((a, b) => a.dayOffset - b.dayOffset || a.label.localeCompare(b.label));

  const scheduledInMinor = inHorizon
    .filter((m) => m.amountMinor > 0)
    .reduce((sum, m) => sum + m.amountMinor, 0);
  const scheduledOutMinor = inHorizon
    .filter((m) => m.amountMinor < 0)
    .reduce((sum, m) => sum + m.amountMinor, 0); // negative
  const estimatedOutMinor = -dailyEstimate * horizon;

  // Checkpoint days: 0, every scheduled day, and the horizon end.
  const checkpointDays = Array.from(
    new Set<number>([0, ...inHorizon.map((m) => m.dayOffset), horizon]),
  ).sort((a, b) => a - b);

  const points: ForecastPoint[] = [];
  let known = Math.round(input.currentBalanceMinor);

  let scheduledApplied = 0; // running index into inHorizon
  for (const day of checkpointDays) {
    // Apply every scheduled movement due on or before this checkpoint
    // that has not been applied yet.
    while (
      scheduledApplied < inHorizon.length &&
      inHorizon[scheduledApplied].dayOffset <= day
    ) {
      known += inHorizon[scheduledApplied].amountMinor;
      scheduledApplied += 1;
    }
    const estimated = known - dailyEstimate * day;
    const dueHere = inHorizon.filter((m) => m.dayOffset === day);
    points.push({
      dayOffset: day,
      label: day === 0
        ? "Today"
        : dueHere.length > 0
        ? dueHere.map((m) => m.label).join(", ")
        : `Day ${day}`,
      knownBalanceMinor: known,
      estimatedBalanceMinor: estimated,
    });
  }

  // The estimated path is monotone between checkpoints only when no
  // scheduled movement lands between them, so the per-checkpoint minimum
  // is the true minimum for the known path; for the estimated path the
  // low is always at a checkpoint too (discretionary dr* is linear and
  // scheduled steps only occur at checkpoints).
  let low = points[0];
  for (const p of points) {
    if (p.estimatedBalanceMinor < low.estimatedBalanceMinor) low = p;
  }

  const end = points[points.length - 1];

  const basis: string[] = [
    `Starting from your current balance.`,
    inHorizon.length === 0
      ? `No scheduled inflows or outflows detected in the next ${horizon} days.`
      : `${inHorizon.length} scheduled item${
        inHorizon.length === 1 ? "" : "s"
      } in the next ${horizon} days` +
        (scheduledInMinor > 0 ? ` (money in and out)` : ` (money out)`) + `.`,
    dailyEstimate > 0
      ? `Plus an estimated everyday spend from your recent history.`
      : `No everyday-spending estimate (not enough history yet).`,
  ];

  return {
    horizonDays: horizon,
    currency: input.currency,
    openingBalanceMinor: Math.round(input.currentBalanceMinor),
    points,
    scheduledInMinor,
    scheduledOutMinor,
    estimatedOutMinor,
    projectedLow: {
      dayOffset: low.dayOffset,
      knownBalanceMinor: low.knownBalanceMinor,
      estimatedBalanceMinor: low.estimatedBalanceMinor,
    },
    projectedEnd: {
      knownBalanceMinor: end.knownBalanceMinor,
      estimatedBalanceMinor: end.estimatedBalanceMinor,
    },
    mayGoNegative: low.estimatedBalanceMinor < 0,
    basis,
    disclaimer: DISCLAIMER,
  };
}
