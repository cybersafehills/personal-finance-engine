import { getSystemTemplate, getOwnedWorkspaceId } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { PageHeader } from "../../../components/PageHeader";
import { BudgetCalculator } from "../../../components/BudgetCalculator";

export const dynamic = "force-dynamic";

async function getWorkspaceDefaultCurrency(): Promise<string> {
  const workspaceId = await getOwnedWorkspaceId();
  if (!workspaceId) return "RWF";
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("workspaces")
    .select("default_currency")
    .eq("id", workspaceId)
    .maybeSingle();
  return data?.default_currency ?? "RWF";
}

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
