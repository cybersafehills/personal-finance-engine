"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addManualContribution,
  archiveGoal,
  completeGoal,
  removeContribution,
} from "../app/budgets/goals/actions";
import { formatMoney, SupportedCurrency } from "../lib/money";
import type { GoalWithContributions } from "../lib/queries";

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function GoalDetailPanel({ goal }: { goal: GoalWithContributions }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [contributionDate, setContributionDate] = useState(todayDateString());

  const currency = goal.currency as SupportedCurrency;
  const isOpen = goal.status === "active";

  function handleAddContribution(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    startTransition(async () => {
      const result = await addManualContribution(goal.id, amountText, contributionDate);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setAmountText("");
      router.refresh();
    });
  }

  function handleRemoveContribution(contributionId: string) {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await removeContribution(contributionId, goal.id);
      if (!result.ok) setErrorMessage(result.error);
      else router.refresh();
    });
  }

  function handleComplete() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await completeGoal(goal.id);
      if (!result.ok) setErrorMessage(result.error);
      else router.refresh();
    });
  }

  function handleArchive() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await archiveGoal(goal.id);
      if (!result.ok) setErrorMessage(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {isOpen && (
        <form
          onSubmit={handleAddContribution}
          className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
        >
          <span className="text-sm font-medium text-text-primary">Add contribution</span>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text-secondary">Amount</span>
              <input
                type="text"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                required
                className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text-secondary">Date</span>
              <input
                type="date"
                value={contributionDate}
                onChange={(e) => setContributionDate(e.target.value)}
                required
                className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {isPending ? "Adding…" : "Add contribution"}
          </button>
        </form>
      )}

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">{errorMessage}</p>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-text-primary">Contributions</span>
        {goal.contributions.length === 0 ? (
          <p className="text-sm text-text-muted">No contributions yet.</p>
        ) : (
          goal.contributions.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-card border border-border-subtle bg-surface p-3"
            >
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {formatMoney(BigInt(c.amount_minor), currency)}
                </p>
                <p className="text-xs text-text-muted">
                  {c.contribution_date} · {c.source === "manual" ? "Manual" : "Linked transaction"}
                </p>
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleRemoveContribution(c.id)}
                className="text-xs font-medium text-text-muted hover:text-attention disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      {isOpen && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={handleComplete}
            className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            Mark complete
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleArchive}
            className="min-h-11 rounded-control border border-border-strong px-4 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      )}
    </div>
  );
}
