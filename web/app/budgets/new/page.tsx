import { getSystemTemplate, getWorkspaceDefaultCurrency } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { BudgetCalculator } from "../../../components/BudgetCalculator";

export const dynamic = "force-dynamic";

export default async function NewBudgetPage() {
  const [systemTemplate, defaultCurrency] = await Promise.all([
    getSystemTemplate(),
    getWorkspaceDefaultCurrency(),
  ]);

  return (
    <div>
      <PageHeader title="New budget" subtitle="Set up income and allocations" />
      <BudgetCalculator systemTemplate={systemTemplate} defaultCurrency={defaultCurrency} />
    </div>
  );
}
