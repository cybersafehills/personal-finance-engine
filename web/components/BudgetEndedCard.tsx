"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startCurrentMonthBudget } from "../app/budgets/actions";
import { Badge } from "./Badge";

/**
 * Home's budget card once the active budget's period is over. Shows no
 * "on track" and no amounts (they describe a finished month): it says so and
 * offers the one tap that copies the budget into this month, archives the
 * ended one and activates the new one.
 */
export function BudgetEndedCard({
  budgetId,
  budgetName,
  periodEnd,
  monthName,
}: {
  budgetId: string;
  budgetName: string;
  periodEnd: string;
  /** The month the new budget would cover, e.g. "November". */
  monthName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Budget status
        </h2>
        <Badge variant="attention">Ended</Badge>
      </div>
      <p className="text-sm text-text-primary">
        {budgetName} ended on {periodEnd}. Nothing is being tracked for {monthName} yet.
      </p>
      {error ? <p role="alert" className="text-sm text-attention">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await startCurrentMonthBudget(budgetId);
              if (!res.ok) setError(res.error);
              else router.refresh();
            });
          }}
          className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
        >
          {pending ? "Starting…" : `Start ${monthName}'s budget`}
        </button>
        <Link href={`/budgets/${budgetId}`} className="text-sm font-medium text-accent hover:underline">
          See {budgetName}
        </Link>
      </div>
    </div>
  );
}
