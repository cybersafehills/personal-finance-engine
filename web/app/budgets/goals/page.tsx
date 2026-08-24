import Link from "next/link";
import { getGoals } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { GoalItem } from "../../../components/GoalItem";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const goals = await getGoals();

  return (
    <div>
      <PageHeader
        title="Goals"
        subtitle="Emergency funds, investing, planned purchases, and debt payoff"
        action={
          <Link
            href="/budgets/goals/new"
            className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
          >
            New goal
          </Link>
        }
      />

      {goals.length === 0 ? (
        <EmptyState
          title="No goals yet"
          description="Create a goal to start tracking progress toward it."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {goals.map((goal) => (
            <GoalItem key={goal.id} goal={goal} />
          ))}
        </div>
      )}
    </div>
  );
}
