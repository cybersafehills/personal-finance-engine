"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { fetchVariableIncomeMonths } from "../app/budgets/actions";
import { computeVariableIncomeRecommendation } from "../lib/budget-math";
import { formatMoney, SupportedCurrency } from "../lib/money";
import { formatDateTime } from "../lib/format";
import type { VariableIncomeMonth } from "../lib/queries";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function monthKeyLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

export function VariableIncomePicker({
  currency,
  expectedMonthlyMinor,
  onAcceptRecommendation,
}: {
  currency: SupportedCurrency;
  expectedMonthlyMinor: bigint | null;
  onAcceptRecommendation: (amountMinor: bigint) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [months, setMonths] = useState<VariableIncomeMonth[] | null>(null);
  const [excludedTransactionIds, setExcludedTransactionIds] = useState<Set<string>>(new Set());

  // Keyed by `currency` from the parent (see BudgetCalculator), so a
  // currency change remounts this component with fresh initial state
  // rather than needing to synchronously reset state inside this effect.
  useEffect(() => {
    startTransition(async () => {
      const result = await fetchVariableIncomeMonths(currency);
      setMonths(result);
    });
  }, [currency]);

  const monthlyTotals = useMemo(() => {
    if (!months) return [];
    return months.map((month) =>
      month.transactions
        .filter((t) => !excludedTransactionIds.has(t.id))
        .reduce((sum, t) => sum + BigInt(t.amountMinor), 0n)
    ).filter((total) => total > 0n);
  }, [months, excludedTransactionIds]);

  const recommendation = useMemo(
    () => computeVariableIncomeRecommendation(monthlyTotals, expectedMonthlyMinor),
    [monthlyTotals, expectedMonthlyMinor],
  );

  function toggleTransaction(id: string) {
    setExcludedTransactionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4">
      <p className="text-sm font-medium text-text-primary">Variable income recommendation</p>
      <p className="text-xs text-text-muted">
        A conservative baseline: the lower of your expected income (if you
        entered one above) and your average qualifying income over the
        previous complete months. This is a suggestion, not a guarantee of
        future income - review the transactions below and exclude anything
        that shouldn&apos;t count.
      </p>

      {isPending && <p className="text-sm text-text-muted">Loading recent income…</p>}

      {!isPending && months && months.length === 0 && (
        <p className="text-sm text-text-muted">
          Not enough transaction history yet to calculate an average. Enter
          an expected amount above, or switch back to fixed income.
        </p>
      )}

      {!isPending && months && months.length > 0 && (
        <div className="flex flex-col gap-3">
          {months.map((month) => (
            <div key={month.monthKey} className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {monthKeyLabel(month.monthKey)}
              </p>
              {month.transactions.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!excludedTransactionIds.has(t.id)}
                    onChange={() => toggleTransaction(t.id)}
                  />
                  <span className="flex-1 text-text-secondary">
                    {t.counterpartyName ?? "Unknown"} · {formatDateTime(t.occurredAt)}
                  </span>
                  <span className="font-medium text-text-primary">
                    {formatMoney(BigInt(t.amountMinor), currency)}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      {recommendation.recommendedMinor !== null && (
        <div className="rounded-control bg-background px-3 py-2 text-sm">
          <p className="text-text-secondary">
            {recommendation.averageMinor !== null
              ? `Average over ${recommendation.monthsUsed} month${recommendation.monthsUsed === 1 ? "" : "s"}: ${formatMoney(recommendation.averageMinor, currency)}`
              : "No historical average available yet"}
          </p>
          <p className="mt-1 font-medium text-text-primary">
            Recommended: {formatMoney(recommendation.recommendedMinor, currency)}
          </p>
          <button
            type="button"
            onClick={() => onAcceptRecommendation(recommendation.recommendedMinor!)}
            className="mt-2 min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground"
          >
            Use this amount
          </button>
        </div>
      )}
    </div>
  );
}
