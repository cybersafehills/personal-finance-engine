import { notFound } from "next/navigation";
import { getBudgetById } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { BudgetStatusBadge, formatCalendarDate } from "../../../components/BudgetStatusBadge";
import { BudgetDetailPanel } from "../../../components/BudgetDetailPanel";
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

  return (
    <div>
      <PageHeader
        title={budget.name}
        subtitle={`${formatCalendarDate(budget.period_start)} – ${formatCalendarDate(budget.period_end)}`}
        action={<BudgetStatusBadge status={budget.status} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-card border border-border-subtle bg-surface p-3">
          <p className="text-xs text-text-muted">Monthly income</p>
          <p className="font-medium text-text-primary">
            {formatMoney(BigInt(budget.normalized_monthly_income_minor), budget.currency)}
          </p>
        </div>
        <div className="rounded-card border border-border-subtle bg-surface p-3">
          <p className="text-xs text-text-muted">Annual income</p>
          <p className="font-medium text-text-primary">
            {formatMoney(BigInt(budget.normalized_annual_income_minor), budget.currency)}
          </p>
        </div>
      </div>

      <BudgetDetailPanel budget={budget} />
    </div>
  );
}
