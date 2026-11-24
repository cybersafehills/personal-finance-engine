// GET /api/mobile/insights/intelligence - the non-forecast half of the web's
// Home "Insights" card and /inbox/forecast page (spending vs. your usual pace,
// unusually large payments, recurring payments, and the one-line summary), in a
// shape the app can verify. Pure (no `server-only`, no Next imports) so it is
// unit-tested under deno; the route only loads and hands over the result.
//
// Same facts as the web, never re-derived: the route passes the output of
// getIntelligenceInsights(). Amounts are integer minor units sent as decimal
// strings; a value that cannot be represented exactly is refused (RangeError ->
// 422), never rounded.

import { summariseInsights, type SummariseInput } from "./summary.ts";

export const MAX_ANOMALIES = 10;
export const MAX_RECURRING = 20;

export type IntelligenceSource =
  & Omit<SummariseInput, "baseline" | "anomalies" | "recurring">
  & {
  walletForecasts: ReadonlyArray<{ walletId: string; isDefault: boolean }>;
  recurring: ReadonlyArray<{
    counterpartyKey: string;
    category: string | null;
    typicalAmountMinor: bigint;
    typicalDayOfMonth: number;
    monthsSeen: number;
  }>;
  baseline:
    | {
      thisMonthToDateRwf: number;
      baselineToSameDayRwf: number;
      changePercent: number | null;
      direction: "above" | "below" | "in_line";
      monthsCompared: number;
      basis: string[];
    }
    | null;
  anomalies: ReadonlyArray<{
    counterpartyKey: string;
    category: string | null;
    amountMinor: number;
    typicalMinor: number;
    timesTypical: number;
    occurredAt: string;
  }>;
};

function exactMinor(value: number | bigint): string {
  if (typeof value === "bigint") return value.toString();
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("intelligence_amount_unavailable");
  }
  return String(value);
}

/** "mtn rwanda" -> "Mtn Rwanda": the same display the web card uses. */
export function titleCase(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function serializeIntelligence(insights: IntelligenceSource) {
  const glimpse = summariseInsights(insights);
  const wallets = insights.walletForecasts;
  const defaultWallet: { walletId: string } | undefined =
    wallets.find((w) => w.isDefault) ?? wallets.at(0);
  const { baseline } = insights;
  return {
    default_wallet_id: (defaultWallet?.walletId ?? null) as string | null,
    summary: glimpse
      ? { headline: glimpse.headline, body: glimpse.body }
      : null,
    // The web only shows the comparison when it has a percentage.
    baseline: baseline && baseline.changePercent !== null
      ? {
        this_month_minor: exactMinor(baseline.thisMonthToDateRwf),
        usual_minor: exactMinor(baseline.baselineToSameDayRwf),
        change_percent: baseline.changePercent,
        direction: baseline.direction,
        months_compared: baseline.monthsCompared,
        basis: baseline.basis,
      }
      : null,
    anomalies: insights.anomalies.slice(0, MAX_ANOMALIES).map((a) => ({
      counterparty: titleCase(a.counterpartyKey),
      category: a.category,
      amount_minor: exactMinor(a.amountMinor),
      typical_minor: exactMinor(a.typicalMinor),
      times_typical: a.timesTypical,
      occurred_at: a.occurredAt,
    })),
    anomalies_total: insights.anomalies.length,
    recurring: insights.recurring.slice(0, MAX_RECURRING).map((p) => ({
      counterparty: titleCase(p.counterpartyKey),
      category: p.category,
      typical_amount_minor: exactMinor(p.typicalAmountMinor),
      typical_day: p.typicalDayOfMonth,
      months_seen: p.monthsSeen,
    })),
    recurring_total: insights.recurring.length,
  };
}
