import "server-only";

import { cache } from "react";
import {
  getActiveWorkspaceId,
  getLinkedTransferIds,
  getTransactions,
} from "../queries";
import { getHomeBalance } from "../wallets/home-balance-data";
import { excludeLinkedTransfers } from "../transfer-exclusion";
import { buildWalletForecast, type ForecastTxn } from "./wallet-forecast";
import { isOneLedger3FlagEnabled } from "../oneledger3-flags";
import { loadWallets } from "../wallets/wallets-data";
import { supabaseSession } from "../supabase-session-server";
import { isBillsEnabled } from "../bills/gate";
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

const HORIZON_DAYS = 30;
const HISTORY_MONTHS = 4;
const DISCRETIONARY_WINDOW_DAYS = 90;
const TRANSACTION_READ_LIMIT = 500;

export type SpendingBaseline = {
  thisMonthToDateRwf: number;
  baselineToSameDayRwf: number;
  changePercent: number | null;
  direction: "above" | "below" | "in_line";
  monthsCompared: number;
  basis: string[];
};

export type WalletForecastEntry = {
  walletId: string;
  name: string;
  isDefault: boolean;
  forecast: CashFlowForecast;
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

function outflowMinor(t: {
  principal_effect_rwf: number | null;
  fee_effect_rwf: number | null;
}): number {
  return Math.abs(
    Number(t.principal_effect_rwf ?? 0) + Number(t.fee_effect_rwf ?? 0),
  );
}

type DueBill = { id: string; totalMinor: number; dueDate: string };

/** Open, unpaid bill obligations with a due date - dated commitments for
 *  the forecast's KNOWN path (ADR 0014). RLS-scoped. */
async function fetchDueBills(): Promise<DueBill[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("bills")
    .select("id, total_minor, due_date")
    .eq("status", "open")
    .eq("paid_state", "unpaid")
    .not("due_date", "is", null);
  if (error) {
    console.error("fetchDueBills failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    totalMinor: Number(r.total_minor),
    dueDate: r.due_date as string,
  }));
}

type ForecastWallet = {
  id: string;
  name: string;
  isDefault: boolean;
  financialSourceId: string;
  balanceMinor: number;
};

/** The wallets a forecast can be built for: RWF, with a balance the provider reported
 *  and a source to read transactions by. Default wallet first. [] = use the combined fallback. */
async function loadForecastWallets(
  workspaceId: string | null,
): Promise<ForecastWallet[]> {
  if (
    !workspaceId ||
    !isOneLedger3FlagEnabled(process.env, "BALANCE_PROVENANCE", workspaceId)
  ) {
    return [];
  }
  try {
    const all = await loadWallets(await supabaseSession(), workspaceId);
    return all
      .filter((w) =>
        w.currency === "RWF" && w.balance.basis === "provider_reported" &&
        w.balance.amountMinor !== null && w.financialSourceId !== null
      )
      .map((w) => ({
        id: w.id,
        name: w.name,
        isDefault: w.isPrimary,
        financialSourceId: w.financialSourceId as string,
        balanceMinor: Number(w.balance.amountMinor),
      }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  } catch (e) {
    console.error(
      "loadForecastWallets failed:",
      e instanceof Error ? e.message : "unknown",
    );
    return [];
  }
}

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

  if (!isIntelligenceEnabled(workspaceId)) {
    return {
      enabled: false,
      forecast: null,
      walletForecasts: [],
      recurring: [],
      baseline: null,
      anomalies: [],
    };
  }

  const billsEnabled = isBillsEnabled(workspaceId);

  const [homeBalance, fetched, dueBills, linked, wallets] = await Promise.all([
    getHomeBalance(),
    getTransactions({ limit: TRANSACTION_READ_LIMIT }),
    billsEnabled ? fetchDueBills() : Promise.resolve([]),
    supabaseSession().then(getLinkedTransferIds),
    loadForecastWallets(workspaceId),
  ]);
  // Moving money between your own wallets is neither spending nor income:
  // drop both legs of every confirmed transfer, as Home, reports and Insights do.
  const transactions = excludeLinkedTransfers(fetched, linked);

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const todayKey = kigaliDateKey(nowIso); // YYYY-MM-DD
  const todayMonthKey = todayKey.slice(0, 7);
  const todayDay = Number(todayKey.slice(8, 10));
  const completeMonths = lastNCompleteMonthKeys(todayMonthKey, HISTORY_MONTHS);

  const settledOut = transactions.filter(
    (t) =>
      t.direction === "out" &&
      t.settlement_state === "settled" &&
      t.counterparty_name != null,
  );

  const toForecastTxns = (rows: typeof transactions): ForecastTxn[] =>
    rows.map((t) => ({
      id: t.id,
      direction: t.direction,
      settled: t.settlement_state === "settled",
      counterpartyName: t.counterparty_name,
      category: t.category,
      amountMinor: outflowMinor(t),
      occurredAt: t.occurred_at,
    }));
  const dueBillInputs = dueBills.map((b) => ({
    totalMinor: b.totalMinor,
    dueDate: b.dueDate,
  }));

  // Workspace-wide recurring list (the "N recurring payments detected" card).
  const recurring = buildWalletForecast({
    balanceMinor: null,
    currency: "RWF",
    txns: toForecastTxns(transactions),
    dueBills: [],
    nowMs,
    truncated: fetched.length >= TRANSACTION_READ_LIMIT,
    horizonDays: HORIZON_DAYS,
    historyMonths: HISTORY_MONTHS,
    windowDays: DISCRETIONARY_WINDOW_DAYS,
  }).recurring;

  // --- forecast: one per wallet, each from its own transactions ----------
  // Wallets are separate accounts, so each gets its own balance, recurring
  // payments, everyday spending and typical income. Bills are not tied to a
  // wallet, so they count against the default wallet only. With wallet
  // balances off (or none usable) it falls back to the one combined forecast.
  const walletForecasts: WalletForecastEntry[] = [];
  if (wallets.length > 0) {
    const perWallet = await Promise.all(
      wallets.map(async (w) => {
        const rows = await getTransactions({
          limit: TRANSACTION_READ_LIMIT,
          sourceId: w.financialSourceId,
        });
        return { w, rows, kept: excludeLinkedTransfers(rows, linked) };
      }),
    );
    const defaultId = (wallets.find((w) => w.isDefault) ?? wallets[0]).id;
    for (const { w, rows, kept } of perWallet) {
      const built = buildWalletForecast({
        balanceMinor: w.balanceMinor,
        currency: "RWF",
        txns: toForecastTxns(kept),
        dueBills: w.id === defaultId ? dueBillInputs : [],
        nowMs,
        truncated: rows.length >= TRANSACTION_READ_LIMIT,
        horizonDays: HORIZON_DAYS,
        historyMonths: HISTORY_MONTHS,
        windowDays: DISCRETIONARY_WINDOW_DAYS,
      });
      if (built.forecast) {
        walletForecasts.push({
          walletId: w.id,
          name: w.name,
          isDefault: w.id === defaultId,
          forecast: built.forecast,
        });
      }
    }
  } else if (homeBalance) {
    const built = buildWalletForecast({
      balanceMinor: homeBalance.amountRwf,
      currency: "RWF",
      txns: toForecastTxns(transactions),
      dueBills: dueBillInputs,
      nowMs,
      truncated: fetched.length >= TRANSACTION_READ_LIMIT,
      horizonDays: HORIZON_DAYS,
      historyMonths: HISTORY_MONTHS,
      windowDays: DISCRETIONARY_WINDOW_DAYS,
    });
    if (built.forecast) {
      walletForecasts.push({
        walletId: "combined",
        name: homeBalance.label,
        isDefault: true,
        forecast: built.forecast,
      });
    }
  }
  const forecast =
    (walletForecasts.find((f) => f.isDefault) ?? walletForecasts[0])
      ?.forecast ??
      null;

  // --- spending baseline comparison -----------------------------------
  let baseline: SpendingBaseline | null = null;
  if (completeMonths.length >= 2) {
    const thisMonthToDate = settledOut
      .filter((t) => kigaliDateKey(t.occurred_at).slice(0, 7) === todayMonthKey)
      .reduce((sum, t) => sum + outflowMinor(t), 0);

    const perMonthToSameDay = completeMonths.map((mk) =>
      settledOut
        .filter((t) => {
          const dk = kigaliDateKey(t.occurred_at);
          return dk.slice(0, 7) === mk &&
            Number(dk.slice(8, 10)) <= todayDay;
        })
        .reduce((sum, t) => sum + outflowMinor(t), 0)
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
      counterpartyKey: t.counterparty_name!.trim().toLowerCase(),
      category: t.category,
      amountMinor: outflowMinor(t),
      occurredAt: t.occurred_at,
    })),
    {
      ...DEFAULT_ANOMALY_OPTIONS,
      since: new Date(
        Date.now() - ANOMALY_RECENCY_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
  );

  return {
    enabled: true,
    forecast,
    walletForecasts,
    recurring,
    baseline,
    anomalies,
  };
}
