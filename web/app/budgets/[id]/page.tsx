import { notFound } from "next/navigation";
import { getBudgetActuals, getBudgetById } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { BudgetStatusBadge, formatCalendarDate } from "../../../components/BudgetStatusBadge";
import { BudgetDetailPanel } from "../../../components/BudgetDetailPanel";
import { AllocationActualsCard } from "../../../components/AllocationActualsCard";
import { AlertsList } from "../../../components/AlertsList";
import { formatMoney, isSupportedCurrency } from "../../../lib/money";

export const dynamic = "force-dynamic";

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const budget = await getBudgetById(id);

  if (!budget || !isSupportedCurrency(budget.currency)) {
    notFound();
  }

  const currency = budget.currency;
  const actuals = await getBudgetActuals(budget);

  return (
    <div>
      <PageHeader
        title={budget.name}
        subtitle={`${formatCalendarDate(budget.period_start)} – ${formatCalendarDate(budget.period_end)}`}
        action={
          <div className="flex items-center gap-3">
            <a
              href={`/budgets/${budget.id}/export`}
              className="text-sm font-medium text-accent hover:underline"
            >
              Export CSV
            </a>
            <BudgetStatusBadge status={budget.status} />
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-card border border-border-subtle bg-surface p-3">
          <p className="text-xs text-text-muted">Budgeted income</p>
          <p className="font-medium text-text-primary">
            {formatMoney(BigInt(budget.normalized_monthly_income_minor), currency)}
          </p>
        </div>
        <div className="rounded-card border border-border-subtle bg-surface p-3">
          <p className="text-xs text-text-muted">Actual income this period</p>
          <p className="font-medium text-text-primary">
            {formatMoney(BigInt(actuals.actualIncomeMinor), currency)}
          </p>
        </div>
      </div>

      <AlertsList alerts={actuals.alerts} currency={currency} />

      <div className="mb-4 flex flex-col gap-3">
        {actuals.allocations.map((allocation) => (
          <AllocationActualsCard
            key={allocation.allocationType}
            actual={allocation}
            currency={currency}
          />
        ))}
      </div>

      <BudgetDetailPanel budget={budget} />
    </div>
  );
}
