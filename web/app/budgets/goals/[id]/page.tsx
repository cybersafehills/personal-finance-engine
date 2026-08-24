import { notFound } from "next/navigation";
import { getGoalById } from "../../../../lib/queries";
import { PageHeader } from "../../../../components/PageHeader";
import { Badge } from "../../../../components/Badge";
import { GoalDetailPanel } from "../../../../components/GoalDetailPanel";
import { formatMoney, isSupportedCurrency } from "../../../../lib/money";

export const dynamic = "force-dynamic";

const GOAL_TYPE_LABELS: Record<string, string> = {
  emergency_fund: "Emergency fund",
  investing: "Investing",
  planned_purchase: "Planned purchase",
  debt: "Debt repayment",
  general_savings: "General savings",
};

export default async function GoalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const goal = await getGoalById(id);

  if (!goal || !isSupportedCurrency(goal.currency)) {
    notFound();
  }

  const currency = goal.currency;
  const percent = goal.target_amount_minor > 0
    ? Math.min(100, Math.round((goal.current_amount_minor / goal.target_amount_minor) * 100))
    : 0;

  return (
    <div>
      <PageHeader
        title={goal.name}
        subtitle={GOAL_TYPE_LABELS[goal.goal_type] ?? goal.goal_type}
        action={
          goal.status === "completed"
            ? <Badge variant="positive">Completed</Badge>
            : goal.status === "archived"
            ? <Badge variant="attention">Archived</Badge>
            : undefined
        }
      />

      {goal.description && (
        <p className="mb-4 text-sm text-text-secondary">{goal.description}</p>
      )}

      <div className="mb-4 rounded-card border border-border-subtle bg-surface p-4">
        <div className="mb-2 h-2 overflow-hidden rounded-full bg-background" role="presentation">
          <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-sm text-text-secondary">
          {formatMoney(BigInt(goal.current_amount_minor), currency)} of{" "}
          {formatMoney(BigInt(goal.target_amount_minor), currency)} ({percent}%)
        </p>
        {goal.target_date && (
          <p className="mt-1 text-xs text-text-muted">Target date: {goal.target_date}</p>
        )}
      </div>

      <GoalDetailPanel goal={goal} />
    </div>
  );
}
