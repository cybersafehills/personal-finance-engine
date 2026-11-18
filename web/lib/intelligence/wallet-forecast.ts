// One wallet's (or one pot of money's) cash-flow forecast, built from its own
// transactions. PURE (imports only other pure modules) so it is unit-tested.
//
// Wallets are separate accounts with separate accounting, so the forecast is
// built per wallet: that wallet's balance, that wallet's recurring payments,
// that wallet's everyday spending and typical income. Nothing from another
// wallet leaks in.

import { kigaliDateKey } from "../kigali-time.ts";
import { lastNCompleteMonthKeys } from "../budget-math.ts";
import {
  detectRecurringPatterns,
  type RecurringCandidateTransaction,
  type RecurringPattern,
} from "../recurring-payments.ts";
import {
  type CashFlowForecast,
  computeCashFlowForecast,
  type ScheduledMovement,
} from "./cash-flow-forecast.ts";
import {
  type DailyRates,
  estimateDailyRates,
  type RateTxn,
} from "./run-rate.ts";

export type ForecastTxn = {
  id: string;
  direction: string;
  settled: boolean;
  counterpartyName: string | null;
  category: string | null;
  /** Positive minor units that moved (fee included for money out). */
  amountMinor: number;
  occurredAt: string;
};

export type DueBillInput = { totalMinor: number; dueDate: string };

export type WalletForecastInput = {
  /** null = no trusted balance, so only the recurring list is returned. */
  balanceMinor: number | null;
  currency: string;
  txns: readonly ForecastTxn[];
  dueBills: readonly DueBillInput[];
  nowMs: number;
  /** True when the read hit its row cap, so older rows may be missing. */
  truncated: boolean;
  horizonDays?: number;
  historyMonths?: number;
  windowDays?: number;
};

export type WalletForecast = {
  recurring: RecurringPattern[];
  rates: DailyRates;
  forecast: CashFlowForecast | null;
};

function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function buildWalletForecast(i: WalletForecastInput): WalletForecast {
  const horizon = i.horizonDays ?? 30;
  const todayKey = kigaliDateKey(new Date(i.nowMs).toISOString());
  const todayMonthKey = todayKey.slice(0, 7);
  const todayDay = Number(todayKey.slice(8, 10));
  const completeMonths = lastNCompleteMonthKeys(
    todayMonthKey,
    i.historyMonths ?? 4,
  );

  const settledOut = i.txns.filter(
    (t) => t.direction === "out" && t.settled && t.counterpartyName != null,
  );
  const candidates: RecurringCandidateTransaction[] = settledOut.map((t) => {
    const dayKey = kigaliDateKey(t.occurredAt);
    return {
      counterpartyKey: t.counterpartyName!.trim().toLowerCase(),
      category: t.category,
      amountMinor: BigInt(t.amountMinor),
      monthKey: dayKey.slice(0, 7),
      dayOfMonth: Number(dayKey.slice(8, 10)),
    };
  });
  const recurring = detectRecurringPatterns(candidates, completeMonths);
  const recurringKeys = new Set(
    recurring.map((p) => `${p.counterpartyKey}::${p.category ?? ""}`),
  );

  const rateTxns: RateTxn[] = i.txns
    .filter((t) => t.settled && (t.direction === "in" || t.direction === "out"))
    .map((t) => ({
      id: t.id,
      direction: t.direction as "in" | "out",
      amountMinor: t.amountMinor,
      occurredAt: t.occurredAt,
      recurringKey: t.counterpartyName
        ? `${t.counterpartyName.trim().toLowerCase()}::${t.category ?? ""}`
        : null,
    }));
  const rates = estimateDailyRates(rateTxns, {
    windowDays: i.windowDays ?? 90,
    nowMs: i.nowMs,
    linked: new Set<string>(), // own-transfer legs are already removed by the caller
    recurringKeys,
    truncated: i.truncated,
  });

  if (i.balanceMinor === null) return { recurring, rates, forecast: null };

  const dim = daysInMonth(todayMonthKey);
  const scheduled: ScheduledMovement[] = recurring.map(
    (p): ScheduledMovement => {
      const rawOffset = p.typicalDayOfMonth - todayDay;
      return {
        label: p.counterpartyKey.replace(/\b\w/g, (c) => c.toUpperCase()),
        dayOffset: rawOffset >= 0 ? rawOffset : rawOffset + dim,
        amountMinor: -Number(p.typicalAmountMinor),
        kind: "recurring_outflow",
        confidence: p.monthsSeen >= 3 ? "high" : "medium",
      };
    },
  );
  for (const bill of i.dueBills) {
    const dueKey = kigaliDateKey(`${bill.dueDate}T12:00:00Z`);
    const dayOffset = Math.round(
      (Date.parse(`${dueKey}T00:00:00Z`) -
        Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000,
    );
    if (dayOffset < 0 || dayOffset > horizon) continue;
    scheduled.push({
      label: "Bill due",
      dayOffset,
      amountMinor: -Math.abs(bill.totalMinor),
      kind: "bill_due",
      confidence: "high",
    });
  }

  const forecast = computeCashFlowForecast({
    currentBalanceMinor: i.balanceMinor,
    currency: i.currency,
    horizonDays: horizon,
    scheduled,
    estimatedDailyDiscretionaryMinor: rates.dailyOutMinor,
    estimatedDailyInflowMinor: rates.dailyInMinor,
  });
  if (rates.windfallCount > 0) {
    forecast.basis.push(
      `${rates.windfallCount} unusually large receipt${
        rates.windfallCount === 1 ? " was" : "s were"
      } left out of the money-in estimate, because one-offs are not income you can plan on.`,
    );
  }
  return { recurring, rates, forecast };
}
