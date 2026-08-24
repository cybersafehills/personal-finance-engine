import Link from "next/link";
import { getBudgets } from "../../lib/queries";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { BudgetStatusBadge, formatCalendarDate } from "../../components/BudgetStatusBadge";
import { formatMoney, isSupportedCurrency } from "../../lib/money";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const budgets = await getBudgets();

  return (
    <div>
      <PageHeader
        title="Budgets"
        subtitle="Your 50/15/5/30 budgets, from draft to archived"
        action={
          <div className="flex items-center gap-3">
            <Link
              href="/budgets/categories"
              className="text-sm font-medium text-accent hover:underline"
            >
              Categories
            </Link>
            <Link
              href="/budgets/new"
              className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
            >
              New budget
            </Link>
          </div>
        }
      />

      {budgets.length === 0 ? (
        <EmptyState
          title="No budgets yet"
          description="Create a budget to start planning with the 50/15/5/30 model."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {budgets.map((budget) => (
            <Link
              key={budget.id}
              href={`/budgets/${budget.id}`}
              className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{budget.name}</span>
                <BudgetStatusBadge status={budget.status} />
              </div>
              <p className="text-xs text-text-muted">
                {formatCalendarDate(budget.period_start)} – {formatCalendarDate(budget.period_end)}
              </p>
              <p className="text-sm text-text-secondary">
                {isSupportedCurrency(budget.currency)
                  ? formatMoney(
                      BigInt(budget.normalized_monthly_income_minor),
                      budget.currency,
                    )
                  : `${budget.normalized_monthly_income_minor} ${budget.currency}`}{" "}
                / month
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
