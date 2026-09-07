import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { StatementsTabs } from "../../../../components/StatementsTabs";
import { GenerateStatementFlow } from "../../../../components/GenerateStatementFlow";
import { isFinancialStatementsEnabled } from "../../../../lib/financial-statements";
import { getStatementFormOptions } from "../../../../lib/statement-generation";
import { getCategorySuggestions } from "../../../../lib/queries";

export const dynamic = "force-dynamic";

export default async function NewStatementPage() {
  if (!isFinancialStatementsEnabled()) notFound();

  const [options, categories] = await Promise.all([
    getStatementFormOptions(),
    getCategorySuggestions(),
  ]);

  return (
    <div>
      <StatementsTabs />
      <PageHeader
        title="Generate a statement"
        subtitle="Choose an account and period, review the totals, then generate a PDF or CSV."
        backHref="/reports/statements"
        backLabel="Statements"
      />

      {!options.ok
        ? (
          <EmptyState
            title="Can't generate a statement right now"
            description={options.kind === "forbidden_role"
              ? "Viewers can't generate statements in this space."
              : "We couldn't load your accounts. Try again in a moment."}
          />
        )
        : (
          <GenerateStatementFlow
            sources={options.sources}
            defaultTimezone={options.timezone}
            categories={categories}
            participants={options.participants}
          />
        )}
    </div>
  );
}
