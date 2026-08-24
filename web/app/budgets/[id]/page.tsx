import Link from "next/link";
import { notFound } from "next/navigation";
import { getBudgetActuals, getBudgetById } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { BudgetStatusBadge, formatCalendarDate } from "../../../components/BudgetStatusBadge";
import { BudgetDetailPanel } from "../../../components/BudgetDetailPanel";
import { AllocationActualsCard } from "../../../components/AllocationActualsCard";
import { formatMoney, isSupportedCurrency } from "../../../lib/money";
import { formatRwf } from "../../../lib/format";

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
  const hasUnresolved = actuals.unmappedCount > 0 || actuals.uncategorizedCount > 0;

  return (
    <div>
      <PageHeader
        title={budget.name}
        subtitle={`${formatCalendarDate(budget.period_start)} – ${formatCalendarDate(budget.period_end)}`}
        action={<BudgetStatusBadge status={budget.status} />}
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

      {hasUnresolved && (
        <Link
          href="/budgets/categories"
          className="mb-4 block rounded-control bg-attention-bg px-3 py-2 text-sm font-medium text-attention"
        >
          {actuals.unmappedCount > 0 && (
            <>{actuals.unmappedCount} unmapped transaction{actuals.unmappedCount === 1 ? "" : "s"} ({formatRwf(actuals.unmappedMinor)}) not counted in any allocation below. </>
          )}
          {actuals.uncategorizedCount > 0 && (
            <>{actuals.uncategorizedCount} uncategorized transaction{actuals.uncategorizedCount === 1 ? "" : "s"} ({formatRwf(actuals.uncategorizedMinor)}) not counted below. </>
          )}
          Review category mappings →
        </Link>
      )}

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
