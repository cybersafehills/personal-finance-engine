import "server-only";

import { cache } from "react";
import { getActiveWorkspaceId } from "../queries";
import { buildWalletForecast } from "./wallet-forecast";
import { loadCashFlowForecast, loadForecastHistory, FORECAST_HISTORY_MONTHS } from "./forecast-data";
import type { WalletForecastEntry } from "./forecast-api";
import { supabaseSession } from "../supabase-session-server";
import { kigaliDateKey } from "../kigali-time";
import { lastNCompleteMonthKeys } from "../budget-math";
import type { RecurringPattern } from "../recurring-payments";
import type { CashFlowForecast } from "./cash-flow-forecast";
import {
  type AmountAnomaly,
  DEFAULT_ANOMALY_OPTIONS,
  detectAmountAnomalies,
} from "./anomaly";

// Release 6 (Intelligence) - the deterministic-first insight assembler
// (ADR 0014). Everything here is computed from the user's own RLS-scoped
// ledger; nothing is invented. Each insight carries a `basis` for
// "Why am I seeing this?".
//
//   INTELLIGENCE_ENABLED    - master switch for the Home dashboard's
//                             cash-flow forecast + spending-baseline
//                             surface.
//   INTELLIGENCE_ALLOWLIST  - optional comma-separated workspace-id
//                             allowlist for a staged rollout; when unset
//                             the master switch enables it everywhere.
//
// Mirrors isBusinessSurfacesEnabled() in lib/experience-mode/gate.ts.
// This only decides what is shown - it is never an authorization check.

export function isIntelligenceEnabled(
  workspaceId?: string | null,
): boolean {
  if (process.env.INTELLIGENCE_ENABLED !== "true") return false;
  const raw = process.env.INTELLIGENCE_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(workspaceId);
}

export type SpendingBaseline = {
  thisMonthToDateRwf: number;
  baselineToSameDayRwf: number;
  changePercent: number | null;
  direction: "above" | "below" | "in_line";
  monthsCompared: number;
  basis: string[];
};

export type IntelligenceInsights = {
  enabled: boolean;
  /** The default wallet's forecast (what Home and the glimpse use). */
  forecast: CashFlowForecast | null;
  /** One per usable wallet, default first. */
  walletForecasts: WalletForecastEntry[];
  recurring: RecurringPattern[];
  baseline: SpendingBaseline | null;
  anomalies: AmountAnomaly[];
};

const ANOMALY_RECENCY_DAYS = 30;

/**
 * React `cache()`-wrapped so app/layout.tsx (for the glimpse banner) and
 * app/page.tsx (for the Home card) share one computation per request.
 */
export const getIntelligenceInsights: () => Promise<IntelligenceInsights> =
  cache(
    _getIntelligenceInsights,
  );

async function _getIntelligenceInsights(): Promise<IntelligenceInsights> {
  const workspaceId = await getActiveWorkspaceId();

  const enabled = !!workspaceId && isIntelligenceEnabled(workspaceId);
  const empty = { enabled, forecast: null, walletForecasts: [], recurring: [], baseline: null, anomalies: [] };
  if (!enabled || !workspaceId) return empty;

  const now = new Date();
  const nowIso = now.toISOString();
  const todayKey = kigaliDateKey(nowIso);
  const todayMonthKey = todayKey.slice(0, 7);
  const todayDay = Number(todayKey.slice(8, 10));
  const completeMonths = lastNCompleteMonthKeys(todayMonthKey, FORECAST_HISTORY_MONTHS);
  const history = supabaseSession().then((client) => loadForecastHistory(client, workspaceId, now));
  const [transactions, walletForecasts] = await Promise.all([
    history,
    loadCashFlowForecast(workspaceId, { now, history }),
  ]).catch((error: unknown) => {
    console.error("Cash-flow insights unavailable:", error instanceof Error ? error.message : "unknown");
    return [null, []] as const;
  });
  if (!transactions) return empty;

  const settledOut = transactions.filter((t) => t.direction === "out" && t.counterpartyName !== null);
  const recurring = buildWalletForecast({
    balanceMinor: null, currency: "RWF", txns: transactions, dueBills: [],
    nowMs: now.getTime(), truncated: false, historyMonths: FORECAST_HISTORY_MONTHS,
  }).recurring;
  const forecast = (walletForecasts.find((f) => f.isDefault) ?? walletForecasts[0])?.forecast ?? null;

  // --- spending baseline comparison -----------------------------------
  let baseline: SpendingBaseline | null = null;
  if (completeMonths.length >= 2) {
    const thisMonthToDate = settledOut
      .filter((t) => kigaliDateKey(t.occurredAt).slice(0, 7) === todayMonthKey)
      .reduce((sum, t) => sum + t.amountMinor, 0);

    const perMonthToSameDay = completeMonths.map((mk) =>
      settledOut
        .filter((t) => {
          const dk = kigaliDateKey(t.occurredAt);
          return dk.slice(0, 7) === mk &&
            Number(dk.slice(8, 10)) <= todayDay;
        })
        .reduce((sum, t) => sum + t.amountMinor, 0)
    );
    const baselineAvg = perMonthToSameDay.reduce((a, b) => a + b, 0) /
      perMonthToSameDay.length;

    const changePercent = baselineAvg > 0
      ? Math.round(((thisMonthToDate - baselineAvg) / baselineAvg) * 100)
      : null;
    const direction: SpendingBaseline["direction"] = changePercent == null
      ? "in_line"
      : changePercent >= 10
      ? "above"
      : changePercent <= -10
      ? "below"
      : "in_line";

    baseline = {
      thisMonthToDateRwf: thisMonthToDate,
      baselineToSameDayRwf: Math.round(baselineAvg),
      changePercent,
      direction,
      monthsCompared: completeMonths.length,
      basis: [
        `Your spending so far this month, through day ${todayDay}.`,
        `Compared with the same first ${todayDay} days of your last ${completeMonths.length} complete months.`,
        `"Above" / "below" is a change of at least 10%.`,
      ],
    };
  }

  // --- high-confidence amount anomalies -------------------------------
  const anomalies = detectAmountAnomalies(
    settledOut.map((t) => ({
      counterpartyKey: t.counterpartyName!.trim().toLowerCase(),
      category: t.category,
      amountMinor: t.amountMinor,
      occurredAt: t.occurredAt,
    })),
    {
      ...DEFAULT_ANOMALY_OPTIONS,
      since: new Date(
        Date.now() - ANOMALY_RECENCY_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
  );

  return {
    enabled,
    forecast,
    walletForecasts,
    recurring,
    baseline,
    anomalies,
  };
}
