import Link from "next/link";
import {
  getCategorizationPolicies,
  getLearnedPolicySuggestionCount,
  getMyFinancialSources,
} from "../../../lib/queries";
import { financialSourceOptions } from "../../../lib/financial-source-options";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { PolicyItem } from "../../../components/PolicyItem";

export const dynamic = "force-dynamic";

export default async function CategorizationRulesPage() {
  const [policies, suggestionCount, sources] = await Promise.all([
    getCategorizationPolicies(),
    getLearnedPolicySuggestionCount(),
    getMyFinancialSources(),
  ]);
  const sourceLabelById = new Map(
    financialSourceOptions(sources).map((s) => [s.id, s.label]),
  );

  return (
    <div>
      <PageHeader
        title="Categorization rules"
        subtitle="Automatically categorize transactions by counterparty, direction, amount, or time"
        backHref="/categories"
        action={
          <div className="flex flex-col gap-2.5 sm:items-end">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <Link href="/categories/insights" className="font-medium text-accent">
                Insights
              </Link>
              <Link href="/categories/rules/suggestions" className="font-medium text-accent">
                Suggestions{suggestionCount > 0 ? ` (${suggestionCount})` : ""}
              </Link>
              <Link href="/categories/rules/history" className="font-medium text-accent">
                History
              </Link>
              <Link href="/categories/rules/templates" className="font-medium text-accent">
                Templates
              </Link>
            </div>
            <Link
              href="/categories/rules/new"
              className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-center text-sm font-medium text-accent-foreground"
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
          {policies.map((policy) => (
            <PolicyItem
              key={policy.id}
              policy={policy}
              scopeSourceLabel={policy.scope_source_id
                ? sourceLabelById.get(policy.scope_source_id) ?? null
                : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
