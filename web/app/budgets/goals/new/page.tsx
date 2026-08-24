import { getWorkspaceDefaultCurrency } from "../../../../lib/queries";
import { PageHeader } from "../../../../components/PageHeader";
import { GoalForm } from "../../../../components/GoalForm";

export const dynamic = "force-dynamic";

export default async function NewGoalPage() {
  const defaultCurrency = await getWorkspaceDefaultCurrency();

  return (
    <div>
      <PageHeader title="New goal" subtitle="Track progress toward a savings, investing, or payoff target" />
      <GoalForm defaultCurrency={defaultCurrency} />
    </div>
  );
}
