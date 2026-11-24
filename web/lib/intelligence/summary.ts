// Pure summariser for the insight glimpse banner + its notification.
// No I/O, no `server-only`, no import of the Next-only insights.ts - it
// takes only the structural subset of IntelligenceInsights it reads, so
// it stays unit-testable under the deno harness.

import { aboutDays, runOutInDays } from "./run-out.ts";

export type SummariseInput = {
  enabled: boolean;
  forecast:
    | {
      horizonDays: number;
      projectedEnd: {
        knownBalanceMinor: number;
        estimatedBalanceMinor: number;
      };
      projectedLow: { dayOffset: number; estimatedBalanceMinor: number };
      mayGoNegative: boolean;
      /** Checkpoints, so the day the money runs out can be worked out. Optional: without them the text stays general. */
      points?: ReadonlyArray<{ dayOffset: number; knownBalanceMinor: number }>;
    }
    | null;
  baseline:
    | {
      direction: "above" | "below" | "in_line";
      changePercent: number | null;
      monthsCompared: number;
    }
    | null;
  anomalies: ReadonlyArray<{ counterpartyKey: string; timesTypical: number }>;
  recurring: ReadonlyArray<unknown>;
};

export type InsightGlimpse = {
  /** Stable, bucketed hash of the salient facts - only a real change flips it. */
  signature: string;
  /** One sentence for the banner. */
  headline: string;
  /** A slightly longer line used as the notification body. */
  body: string;
};

/** Round to the nearest `step` so sub-bucket noise never flips the signature. */
function bucket(minor: number, step = 5000): number {
  return Math.round(minor / step) * step;
}

function titleCase(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Returns null when Intelligence is off or there is nothing worth a
 * glimpse. Otherwise `{ signature, headline, body }` - the signature is
 * what note_insight_change() de-dupes on.
 */
export function summariseInsights(
  insights: SummariseInput,
): InsightGlimpse | null {
  if (!insights.enabled) return null;
  const { forecast, baseline, anomalies, recurring } = insights;
  if (!forecast && !baseline && anomalies.length === 0) return null;

  const signature = JSON.stringify({
    neg: forecast?.mayGoNegative ?? false,
    end: forecast ? bucket(forecast.projectedEnd.estimatedBalanceMinor) : null,
    low: forecast ? bucket(forecast.projectedLow.estimatedBalanceMinor) : null,
    base: baseline?.direction ?? null,
    anom: anomalies.length,
    rec: recurring.length,
  });

  let headline: string;
  let body: string;

  if (forecast?.mayGoNegative) {
    // The day the money is used up - not `projectedLow.dayOffset`, which is the lowest point (usually the last day).
    const days = forecast.points
      ? runOutInDays({
        horizonDays: forecast.horizonDays,
        points: forecast.points,
        projectedEnd: forecast.projectedEnd,
      })
      : null;
    headline = days === null
      ? `Heads up — your balance could go below zero within ${forecast.horizonDays} days at your recent pace.`
      : days <= 0
      ? "Heads up — at your recent pace, your balance is already below zero."
      : `Heads up — at your recent pace, your money could run out ${
        aboutDays(days)
      }.`;
    body = `Scheduled items alone leave you at ` +
      `${
        Math.round(forecast.projectedEnd.knownBalanceMinor).toLocaleString()
      } RWF after ${forecast.horizonDays} days. ` +
      `Money that arrives sooner would stretch it. ` +
      `This is an estimate from recent spending, not a guaranteed outcome.`;
  } else if (anomalies.length > 0) {
    const a = anomalies[0];
    headline = `A payment to ${
      titleCase(a.counterpartyKey)
    } looks unusually large — about ${a.timesTypical}× the usual.`;
    body = `${
      anomalies.length === 1 ? "One payment" : `${anomalies.length} payments`
    } stood out against that counterparty's usual amount in the last 30 days.`;
  } else if (
    baseline && baseline.direction === "above" && baseline.changePercent != null
  ) {
    headline = `You're spending about ${
      Math.abs(baseline.changePercent)
    }% above your usual pace this month.`;
    body =
      `Measured over the same first ${
        new Date().getUTCDate()
      } days versus your last ` +
      `${baseline.monthsCompared} complete months.`;
  } else {
    headline = "Your 30-day forecast has been updated.";
    body = "Open the forecast for the full breakdown.";
  }

  return { signature, headline, body };
}
