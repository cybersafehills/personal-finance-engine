"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  allocateAmounts,
  AllocationPercentages,
  ALLOCATION_TYPES,
  AllocationType,
  IncomeFrequency,
  INCOME_FREQUENCIES,
  isExactly100Percent,
  isPerPaycheckFrequency,
  normalizeIncome,
  STANDARD_ALLOCATION_PERCENTAGES,
  validatePercentages,
} from "../lib/budget-math";
import {
  formatMoney,
  isSupportedCurrency,
  SUPPORTED_CURRENCIES,
  SupportedCurrency,
  toMajorUnits,
  toMinorUnits,
} from "../lib/money";
import { activateBudget, createBudget } from "../app/budgets/actions";
import { VariableIncomePicker } from "./VariableIncomePicker";
import type { SystemTemplate } from "../lib/queries";

const FREQUENCY_LABELS: Record<IncomeFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  annual: "Annual",
};

const ALLOCATION_LABELS: Record<AllocationType, string> = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

const ALLOCATION_DESCRIPTIONS: Record<AllocationType, string> = {
  ESSENTIALS: "Housing, utilities, groceries, transport, minimum debt payments.",
  INVESTING: "Retirement, brokerage, pension, and other long-term contributions.",
  EMERGENCY: "Liquid savings set aside for unexpected costs.",
  WANTS: "Dining out, entertainment, travel, subscriptions, and other discretionary spending.",
};

function currentMonthBounds(): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

export function BudgetCalculator({
  systemTemplate,
  defaultCurrency,
}: {
  systemTemplate: SystemTemplate | null;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const standardPercentages = useMemo<AllocationPercentages>(() => {
    if (!systemTemplate) return STANDARD_ALLOCATION_PERCENTAGES;
    const fromTemplate = Object.fromEntries(
      systemTemplate.allocations.map((a) => [a.allocation_type, a.percentage]),
    ) as AllocationPercentages;
    return ALLOCATION_TYPES.every((t) => fromTemplate[t] !== undefined)
      ? fromTemplate
      : STANDARD_ALLOCATION_PERCENTAGES;
  }, [systemTemplate]);

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<SupportedCurrency>(
    isSupportedCurrency(defaultCurrency) ? defaultCurrency : "RWF",
  );
  const [incomeAmountText, setIncomeAmountText] = useState("");
  const [incomeFrequency, setIncomeFrequency] = useState<IncomeFrequency>("monthly");
  const [incomeMode, setIncomeMode] = useState<"fixed" | "variable">("fixed");
  const [percentages, setPercentages] = useState<AllocationPercentages>(standardPercentages);
  const [viewMode, setViewMode] = useState<"perPaycheck" | "monthly" | "annual">("monthly");
  const { periodStart, periodEnd } = useMemo(() => currentMonthBounds(), []);

  const perPaycheck = isPerPaycheckFrequency(incomeFrequency);
  const effectiveView = !perPaycheck && viewMode === "perPaycheck" ? "monthly" : viewMode;

  const percentageValidation = validatePercentages(percentages);
  const remainingPercent = percentageValidation.valid
    ? Math.round((100 - percentageValidation.totalPercent) * 100) / 100
    : null;
  const readyToActivate = isExactly100Percent(percentages);

  let incomeAmountMinor: bigint | null = null;
  let incomeParseError: string | null = null;
  try {
    incomeAmountMinor = incomeAmountText.trim()
      ? toMinorUnits(incomeAmountText, currency)
      : 0n;
  } catch {
    incomeParseError = "Enter a valid amount.";
  }

  const normalized = incomeAmountMinor !== null
    ? normalizeIncome(incomeAmountMinor, incomeFrequency)
    : null;

  const previewTotalMinor = normalized
    ? effectiveView === "annual"
      ? normalized.annualMinor
      : effectiveView === "monthly"
      ? normalized.monthlyMinor
      : incomeAmountMinor! // perPaycheck: the raw entered paycheck amount
    : 0n;

  const previewTargets = percentageValidation.valid
    ? allocateAmounts(previewTotalMinor, percentages)
    : null;

  function updatePercentage(type: AllocationType, value: string) {
    const numeric = value === "" ? 0 : Number(value);
    setPercentages((prev) => ({ ...prev, [type]: Number.isFinite(numeric) ? numeric : prev[type] }));
  }

  function resetToStandard() {
    setPercentages(standardPercentages);
  }

  function submit(activateAfterSave: boolean) {
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage("Give this budget a name.");
      return;
    }
    if (incomeParseError) {
      setErrorMessage(incomeParseError);
      return;
    }
    if (!percentageValidation.valid) {
      setErrorMessage(percentageValidation.error);
      return;
    }
    if (activateAfterSave && !readyToActivate) {
      setErrorMessage("Allocation percentages must total exactly 100% to activate.");
      return;
    }

    startTransition(async () => {
      const created = await createBudget({
        name: name.trim(),
        currency,
        periodStart,
        periodEnd,
        incomeAmountText: incomeAmountText.trim() || "0",
        incomeFrequency,
        incomeMode,
        percentages,
        templateId: systemTemplate?.id ?? null,
      });

      if (!created.ok) {
        setErrorMessage(created.error);
        return;
      }

      if (activateAfterSave) {
        const activated = await activateBudget(created.budgetId);
        if (!activated.ok) {
          setErrorMessage(
            `Budget saved as a draft, but activation failed: ${activated.error}`,
          );
          router.push(`/budgets/${created.budgetId}`);
          return;
        }
      }

      router.push(`/budgets/${created.budgetId}`);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-card border border-border-subtle bg-surface p-4">
        <p className="text-xs text-text-muted">
          The 50/15/5/30 model splits your income into four buckets:
          essentials, long-term investing, emergency savings, and wants.
          Enter your income, adjust the percentages if you like, and save
          as a draft or activate it right away.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Budget name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. August budget"
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Currency</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
            className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Income frequency</span>
          <select
            value={incomeFrequency}
            onChange={(e) => setIncomeFrequency(e.target.value as IncomeFrequency)}
            className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
          >
            {INCOME_FREQUENCIES.map((f) => (
              <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex gap-2 rounded-control bg-background p-1 text-sm">
        {(["fixed", "variable"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setIncomeMode(mode)}
            className={`flex-1 rounded-control py-1.5 font-medium transition-colors ${
              incomeMode === mode ? "bg-surface text-text-primary shadow-sm" : "text-text-muted"
            }`}
          >
            {mode === "fixed" ? "Fixed income" : "Variable income"}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">
          {perPaycheck ? "Take-home pay per paycheck" : `${FREQUENCY_LABELS[incomeFrequency]} take-home income`}
          {incomeMode === "variable" && " (expected - optional)"}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={incomeAmountText}
          onChange={(e) => setIncomeAmountText(e.target.value)}
          placeholder={currency === "RWF" ? "500000" : "1250.00"}
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
        {incomeParseError && (
          <span className="text-xs text-attention">{incomeParseError}</span>
        )}
      </label>

      {incomeMode === "variable" && (
        <VariableIncomePicker
          key={currency}
          currency={currency}
          expectedMonthlyMinor={normalized?.monthlyMinor ?? null}
          onAcceptRecommendation={(amountMinor) => {
            setIncomeFrequency("monthly");
            setIncomeAmountText(String(toMajorUnits(amountMinor, currency)));
          }}
        />
      )}

      <div className="rounded-card border border-border-subtle bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text-primary">Allocations</span>
          <button
            type="button"
            onClick={resetToStandard}
            className="text-xs font-medium text-accent hover:underline"
          >
            Reset to 50/15/5/30
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {ALLOCATION_TYPES.map((type) => (
            <div key={type} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {ALLOCATION_LABELS[type]}
                </span>
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
              </div>
              <p className="text-xs text-text-muted">{ALLOCATION_DESCRIPTIONS[type]}</p>
              {previewTargets && (
                <p className="text-sm font-medium text-text-secondary">
                  {formatMoney(previewTargets[type], currency)}
                </p>
              )}
            </div>
          ))}
        </div>

        <div
          className={`mt-3 rounded-control px-3 py-2 text-sm font-medium ${
            readyToActivate
              ? "bg-money-positive-bg text-money-positive"
              : "bg-attention-bg text-attention"
          }`}
          role="status"
        >
          {percentageValidation.valid
            ? readyToActivate
              ? "Allocations total 100% - ready to activate."
              : `${remainingPercent}% unallocated. Must total 100% to activate.`
            : percentageValidation.error}
        </div>
      </div>

      <div className="flex gap-2 rounded-control bg-background p-1 text-sm">
        {(perPaycheck ? (["perPaycheck", "monthly", "annual"] as const) : (["monthly", "annual"] as const)).map(
          (mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`flex-1 rounded-control py-1.5 font-medium transition-colors ${
                effectiveView === mode
                  ? "bg-surface text-text-primary shadow-sm"
                  : "text-text-muted"
              }`}
            >
              {mode === "perPaycheck" ? "Per paycheck" : mode === "monthly" ? "Monthly" : "Annual"}
            </button>
          ),
        )}
      </div>

      {normalized && (
        <div className="grid grid-cols-2 gap-3 text-sm text-text-muted">
          <p>Monthly: <span className="font-medium text-text-primary">{formatMoney(normalized.monthlyMinor, currency)}</span></p>
          <p>Annual: <span className="font-medium text-text-primary">{formatMoney(normalized.annualMinor, currency)}</span></p>
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">{errorMessage}</p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit(false)}
          className="min-h-11 rounded-control border border-border-strong px-4 text-sm font-medium text-text-primary disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit(true)}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save & activate"}
        </button>
      </div>
    </div>
  );
}
