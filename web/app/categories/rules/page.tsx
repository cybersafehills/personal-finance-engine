import Link from "next/link";
import { getCategorizationPolicies } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { PolicyItem } from "../../../components/PolicyItem";

export const dynamic = "force-dynamic";

export default async function CategorizationRulesPage() {
  const policies = await getCategorizationPolicies();

  return (
    <div>
      <PageHeader
        title="Categorization rules"
        subtitle="Automatically categorize transactions by counterparty, direction, amount, or time"
        action={
          <div className="flex items-center gap-3">
            <Link href="/categories/rules/templates" className="text-sm font-medium text-accent">
              Templates
            </Link>
            <Link
              href="/categories/rules/new"
              className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
            >
              New rule
            </Link>
          </div>
        }
      />

      {policies.length === 0 ? (
        <EmptyState
          title="No rules yet"
          description="Create a rule to automatically categorize matching transactions as they come in."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {policies.map((policy) => <PolicyItem key={policy.id} policy={policy} />)}
        </div>
      )}
    </div>
  );
}
