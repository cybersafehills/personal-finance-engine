"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  activateBudget,
  archiveBudget,
  duplicateBudget,
  updateBudgetAllocations,
} from "../app/budgets/actions";
import {
  AllocationPercentages,
  ALLOCATION_TYPES,
  AllocationType,
  isExactly100Percent,
  validatePercentages,
} from "../lib/budget-math";
import { formatMoney, SupportedCurrency } from "../lib/money";
import type { BudgetWithAllocations } from "../lib/queries";

const ALLOCATION_LABELS: Record<AllocationType, string> = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

function nextCalendarMonth(periodStart: string): { periodStart: string; periodEnd: string } {
  const [year, month] = periodStart.split("-").map(Number);
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

export function BudgetDetailPanel({ budget }: { budget: BudgetWithAllocations }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const currency = budget.currency as SupportedCurrency;
  const initialPercentages = Object.fromEntries(
    budget.allocations.map((a) => [a.allocation_type, Number(a.percentage)]),
  ) as AllocationPercentages;
  const [percentages, setPercentages] = useState<AllocationPercentages>(initialPercentages);

  const validation = validatePercentages(percentages);
  const readyToActivate = isExactly100Percent(percentages);
  const canEdit = budget.status === "draft" || budget.status === "active";

  function updatePercentage(type: AllocationType, value: string) {
    const numeric = value === "" ? 0 : Number(value);
    setPercentages((prev) => ({ ...prev, [type]: Number.isFinite(numeric) ? numeric : prev[type] }));
  }

  function saveAllocations() {
    setErrorMessage(null);
    if (!validation.valid) {
      setErrorMessage(validation.error);
      return;
    }
    startTransition(async () => {
      const result = await updateBudgetAllocations(budget.id, percentages);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setIsEditing(false);
      router.refresh();
    });
  }

  function handleActivate() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await activateBudget(budget.id);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleArchive() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await archiveBudget(budget.id);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleCreateNextMonth() {
    setErrorMessage(null);
    const { periodStart, periodEnd } = nextCalendarMonth(budget.period_start);
    startTransition(async () => {
      const result = await duplicateBudget(budget.id, periodStart, periodEnd);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.push(`/budgets/${result.budgetId}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border-subtle bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">Allocations</span>
          {canEdit && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-xs font-medium text-accent hover:underline"
            >
              Edit
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {ALLOCATION_TYPES.map((type) => {
            const allocation = budget.allocations.find((a) => a.allocation_type === type);
            return (
              <div key={type} className="flex items-center justify-between gap-2">
                <span className="text-sm text-text-primary">{ALLOCATION_LABELS[type]}</span>
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={0.5}
                      value={percentages[type]}
                      onChange={(e) => updatePercentage(type, e.target.value)}
                      className="min-h-9 w-20 rounded-control border border-border-strong bg-background px-2 py-1 text-right text-sm text-text-primary"
                      aria-label={`${ALLOCATION_LABELS[type]} percentage`}
                    />
                    <span className="text-sm text-text-muted">%</span>
                  </div>
                ) : (
                  <div className="text-right">
                    <p className="text-sm font-medium text-text-primary">
                      {formatMoney(BigInt(allocation?.target_amount_minor ?? 0), currency)}
                    </p>
                    <p className="text-xs text-text-muted">{Number(allocation?.percentage ?? 0)}%</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isEditing && (
          <>
            <div
              className={`mt-3 rounded-control px-3 py-2 text-sm font-medium ${
                readyToActivate
                  ? "bg-money-positive-bg text-money-positive"
                  : "bg-attention-bg text-attention"
              }`}
              role="status"
            >
              {validation.valid
                ? readyToActivate
                  ? "Totals 100%."
                  : `Totals ${validation.totalPercent}%. Must total 100% to keep this budget active.`
                : validation.error}
            </div>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                disabled={isPending}
                onClick={saveAllocations}
                className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPercentages(initialPercentages);
                  setIsEditing(false);
                  setErrorMessage(null);
                }}
                className="min-h-9 text-xs font-medium text-text-muted"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">{errorMessage}</p>
      )}

      <div className="flex flex-wrap gap-3">
        {budget.status === "draft" && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleActivate}
            className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            Activate
          </button>
        )}
        {(budget.status === "draft" || budget.status === "active") && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleArchive}
            className="min-h-11 rounded-control border border-border-strong px-4 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            Archive
          </button>
        )}
        <button
          type="button"
          disabled={isPending}
          onClick={handleCreateNextMonth}
          className="min-h-11 rounded-control border border-border-strong px-4 text-sm font-medium text-text-primary disabled:opacity-50"
        >
          Create next month
        </button>
      </div>
    </div>
  );
}
