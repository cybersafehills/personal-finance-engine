import Link from "next/link";
import { getCategorizationInsights } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { StatTile } from "../../../components/StatTile";
import { EmptyState } from "../../../components/EmptyState";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  auto: "Auto-categorized",
  provisional: "Provisional",
  suggested: "Suggested",
  conflict: "Conflict",
  uncategorized: "Uncategorized",
};

function percent(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

export default async function CategorizationInsightsPage() {
  const insights = await getCategorizationInsights();
  const total = insights.totalTransactions;

  return (
    <div>
      <PageHeader
        title="Categorization insights"
        subtitle="How well your rules are covering your transactions"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Total transactions" value={total.toLocaleString()} />
        <StatTile label="Active rules" value={insights.activePolicyCount.toLocaleString()} />
        <StatTile
          label="Correction rate"
          value={insights.correctionRate === null ? "—" : `${Math.round(insights.correctionRate * 100)}%`}
          hint="of automatic decisions later corrected by you"
        />
        {Object.entries(STATUS_LABELS).map(([status, label]) => (
          <StatTile
            key={status}
            label={label}
            value={(insights.statusCounts[status] ?? 0).toLocaleString()}
            hint={percent(insights.statusCounts[status] ?? 0, total)}
          />
        ))}
      </div>

      <section className="mt-4 rounded-card border border-border-subtle bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Rules that have never matched
        </p>
        {insights.unusedPolicies.length === 0
          ? (
            <p className="mt-2 text-sm text-text-muted">
              Every active rule has matched at least one transaction.
            </p>
          )
          : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {insights.unusedPolicies.map((p) => (
                <li key={p.id} className="text-sm">
                  <Link href={`/categories/rules/${p.id}/edit`} className="font-medium text-accent">
                    {p.name ?? p.category}
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </section>

      {total === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No transactions yet"
            description="Insights will populate once transactions start coming in."
          />
        </div>
      )}
    </div>
  );
}
