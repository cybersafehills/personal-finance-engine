"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGoal } from "../app/budgets/goals/actions";
import { SUPPORTED_CURRENCIES, SupportedCurrency } from "../lib/money";

const GOAL_TYPE_OPTIONS = [
  { value: "emergency_fund", label: "Emergency fund" },
  { value: "investing", label: "Investing" },
  { value: "planned_purchase", label: "Planned purchase" },
  { value: "debt", label: "Debt repayment" },
  { value: "general_savings", label: "General savings" },
] as const;

export function GoalForm({ defaultCurrency }: { defaultCurrency: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [goalType, setGoalType] = useState<string>("general_savings");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState<SupportedCurrency>(
    (SUPPORTED_CURRENCIES as readonly string[]).includes(defaultCurrency)
      ? (defaultCurrency as SupportedCurrency)
      : "RWF",
  );
  const [targetAmountText, setTargetAmountText] = useState("");
  const [targetDate, setTargetDate] = useState("");

  function submit() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await createGoal({
        goalType,
        name,
        description,
        currency,
        targetAmountText,
        targetDate: targetDate || null,
      });
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.push(`/budgets/goals/${result.goalId}`);
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Goal type</span>
        <select
          value={goalType}
          onChange={(e) => setGoalType(e.target.value)}
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        >
          {GOAL_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. 6-month emergency fund"
          required
          autoFocus
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Description (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
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
          <span className="font-medium text-text-secondary">Target amount</span>
          <input
            type="text"
            inputMode="decimal"
            value={targetAmountText}
            onChange={(e) => setTargetAmountText(e.target.value)}
            placeholder={currency === "RWF" ? "500000" : "5000.00"}
            required
            className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Target date (optional)</span>
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">{errorMessage}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create goal"}
      </button>
    </form>
  );
}
