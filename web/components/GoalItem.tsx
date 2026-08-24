import Link from "next/link";
import { Badge } from "./Badge";
import { formatMoney, isSupportedCurrency } from "../lib/money";
import type { GoalRow, GoalType } from "../lib/queries";

const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  emergency_fund: "Emergency fund",
  investing: "Investing",
  planned_purchase: "Planned purchase",
  debt: "Debt repayment",
  general_savings: "General savings",
};

export function GoalItem({ goal }: { goal: GoalRow }) {
  if (!isSupportedCurrency(goal.currency)) return null;

  const percent = goal.target_amount_minor > 0
    ? Math.min(100, Math.round((goal.current_amount_minor / goal.target_amount_minor) * 100))
    : 0;

  return (
    <Link
      href={`/budgets/goals/${goal.id}`}
      className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-text-primary">{goal.name}</span>
        {goal.status === "completed" && <Badge variant="positive">Completed</Badge>}
        {goal.status === "archived" && <Badge variant="attention">Archived</Badge>}
      </div>
      <p className="text-xs text-text-muted">{GOAL_TYPE_LABELS[goal.goal_type]}</p>

      <div className="h-1.5 overflow-hidden rounded-full bg-background" role="presentation">
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>

      <p className="text-sm text-text-secondary">
        {formatMoney(BigInt(goal.current_amount_minor), goal.currency)} of{" "}
        {formatMoney(BigInt(goal.target_amount_minor), goal.currency)} ({percent}%)
      </p>
    </Link>
  );
}
