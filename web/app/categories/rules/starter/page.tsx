import Link from "next/link";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { formatRwf } from "../../../../lib/format";
import { newRuleHref, proposeStarterRules } from "../../../../lib/starter-rules";
import { loadStarterInputs } from "../../../../lib/starter-rules-data";

export const dynamic = "force-dynamic";

const DIRECTION_LABEL = { in: "Money in", out: "Money out", mixed: "In and out" } as const;

// Read-only: it proposes, and every proposal opens the normal New rule form
// (prefilled), whose own preview and "apply to past transactions" step is where
// you approve. Nothing is created or changed on this page.
export default async function StarterRulesPage() {
  const inputs = await loadStarterInputs();
  const result = proposeStarterRules(inputs.uncategorized, inputs.categorized);
  const capped = inputs.capped;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Starter rules"
        subtitle="Suggested rules for transactions that have no category yet. Nothing is applied until you create the rule and approve it."
        backHref="/categories/rules"
      />

      {result.proposals.length === 0
        ? (
          <EmptyState
            title={result.totalUncategorized === 0 ? "Everything has a category" : "No clear patterns yet"}
            description={result.totalUncategorized === 0
              ? "Nothing is waiting for a category."
              : "Rules need a name that appears on at least two uncategorized transactions."}
          />
        )
        : (
          <>
            <p className="text-sm text-text-secondary">
              {result.totalUncategorized}
              {capped ? "+" : ""} transactions have no category. These {result.proposals.length}{" "}
              suggestions{result.totalProposals > result.proposals.length ? ` (the biggest of ${result.totalProposals})` : ""}
              {" "}would cover {result.coveredCount} of them
              {result.nameless > 0 ? `; ${result.nameless} have no name to match on` : ""}.
            </p>
            <ul className="flex flex-col gap-2">
              {result.proposals.map((p) => (
                <li
                  key={p.key}
                  className="flex flex-col gap-1.5 rounded-card border border-border-subtle bg-surface p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-text-primary">{p.counterparty}</span>
                    <span className="shrink-0 text-xs text-text-muted">
                      {p.txnCount} transactions · {formatRwf(p.totalRwf)} · {DIRECTION_LABEL[p.direction]}
                    </span>
                  </div>
                  {p.suggestedCategory
                    ? (
                      <p className="text-xs text-text-secondary">
                        Suggested category: <strong>{p.suggestedCategory}</strong>. {p.suggestionBasis}
                      </p>
                    )
                    : (
                      <p className="text-xs text-text-muted">
                        No category suggested - you choose it in the next step.
                      </p>
                    )}
                  <div>
                    <Link
                      href={newRuleHref(p)}
                      className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline"
                    >
                      Review this rule →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
    </div>
  );
}
