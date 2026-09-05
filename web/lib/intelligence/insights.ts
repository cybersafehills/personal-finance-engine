import "server-only";

import {
  getActiveWorkspaceId,
  getCurrentBalance,
  getTransactions,
} from "../queries";
import { supabaseSession } from "../supabase-session-server";
import { isBillsEnabled } from "../bills/gate";
import { kigaliDateKey } from "../kigali-time";
import { lastNCompleteMonthKeys } from "../budget-math";
import {
  detectRecurringPatterns,
  type RecurringCandidateTransaction,
  type RecurringPattern,
} from "../recurring-payments";
import {
  type CashFlowForecast,
  computeCashFlowForecast,
  type ScheduledMovement,
} from "./cash-flow-forecast";
import {
  type AmountAnomaly,
  DEFAULT_ANOMALY_OPTIONS,
  detectAmountAnomalies,
} from "./anomaly";

// Release 6 (Intelligence) - the deterministic-first insight assembler
// (ADR 0014). Gated by INTELLIGENCE_ENABLED. Everything here is computed
// from the user's own RLS-scoped ledger; nothing is invented. Each
// insight carries a `basis` for "Why am I seeing this?".

export function isIntelligenceEnabled(): boolean {
  return process.env.INTELLIGENCE_ENABLED === "true";
}

const HORIZON_DAYS = 30;
const HISTORY_MONTHS = 4;
const DISCRETIONARY_WINDOW_DAYS = 90;

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
  forecast: CashFlowForecast | null;
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

function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
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

export async function getIntelligenceInsights(): Promise<IntelligenceInsights> {
  if (!isIntelligenceEnabled()) {
    return {
      enabled: false,
      forecast: null,
      recurring: [],
      baseline: null,
      anomalies: [],
    };
  }

  const workspaceId = await getActiveWorkspaceId();
  const billsEnabled = isBillsEnabled(workspaceId);

  const [balance, transactions, dueBills] = await Promise.all([
    getCurrentBalance(),
    getTransactions({ limit: 500 }),
    billsEnabled ? fetchDueBills() : Promise.resolve([]),
  ]);

  const nowIso = new Date().toISOString();
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

  // --- recurring detection (wires the pure detector) ---------------------
  const candidates: RecurringCandidateTransaction[] = settledOut.map((t) => {
    const dayKey = kigaliDateKey(t.occurred_at);
    return {
      counterpartyKey: t.counterparty_name!.trim().toLowerCase(),
      category: t.category,
      amountMinor: BigInt(outflowMinor(t)),
      monthKey: dayKey.slice(0, 7),
      dayOfMonth: Number(dayKey.slice(8, 10)),
    };
  });
  const recurring = detectRecurringPatterns(candidates, completeMonths);

  // --- estimated daily discretionary spend ------------------------------
  const recurringKeys = new Set(
    recurring.map((p) => `${p.counterpartyKey}::${p.category ?? ""}`),
  );
  const windowCutoff = new Date(
    Date.now() - DISCRETIONARY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const discretionary = settledOut.filter(
    (t) =>
      t.occurred_at >= windowCutoff &&
      !recurringKeys.has(
        `${t.counterparty_name!.trim().toLowerCase()}::${t.category ?? ""}`,
      ),
  );
  const discretionaryTotal = discretionary.reduce(
    (sum, t) => sum + outflowMinor(t),
    0,
  );
  const estimatedDailyDiscretionaryMinor = discretionary.length >= 10
    ? Math.round(discretionaryTotal / DISCRETIONARY_WINDOW_DAYS)
    : 0;

  // --- scheduled movements for the horizon -----------------------------
  const dim = daysInMonth(todayMonthKey);
  const scheduled: ScheduledMovement[] = recurring.map((p): ScheduledMovement => {
    const rawOffset = p.typicalDayOfMonth - todayDay;
    const dayOffset = rawOffset >= 0 ? rawOffset : rawOffset + dim;
    return {
      label: p.counterpartyKey.replace(/\b\w/g, (c) => c.toUpperCase()),
      dayOffset,
      amountMinor: -Number(p.typicalAmountMinor),
      kind: "recurring_outflow",
      confidence: p.monthsSeen >= 3 ? "high" : "medium",
    };
  });

  // Bill obligations are dated commitments - add them to the KNOWN path.
  for (const bill of dueBills) {
    const dueKey = kigaliDateKey(`${bill.dueDate}T12:00:00Z`);
    const dayOffset = Math.round(
      (Date.parse(`${dueKey}T00:00:00Z`) -
        Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000,
    );
    if (dayOffset < 0 || dayOffset > HORIZON_DAYS) continue;
    scheduled.push({
      label: "Bill due",
      dayOffset,
      amountMinor: -Math.abs(bill.totalMinor),
      kind: "bill_due",
      confidence: "high",
    });
  }

  const forecast = balance
    ? computeCashFlowForecast({
      currentBalanceMinor: balance.amountRwf,
      currency: "RWF",
      horizonDays: HORIZON_DAYS,
      scheduled,
      estimatedDailyDiscretionaryMinor,
    })
    : null;

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

  return { enabled: true, forecast, recurring, baseline, anomalies };
}
