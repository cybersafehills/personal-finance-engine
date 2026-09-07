import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { StatementsTabs } from "../../../components/StatementsTabs";
import { StatementStatusBadge } from "../../../components/StatementStatusBadge";
import { isFinancialStatementsEnabled } from "../../../lib/financial-statements";
import { getStatements, type StatementScopeName } from "../../../lib/queries";
import { reconstructStatementPeriod } from "../../../lib/statement-period";
import { formatZonedDateTime } from "../../../lib/format";

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<StatementScopeName, string> = {
  single_account: "Single account",
  all_accounts: "Consolidated",
  filtered: "Filtered",
};

const generateCta = (
  <Link
    href="/reports/statements/new"
    className="inline-flex min-h-11 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
  >
    Generate statement
  </Link>
);

export default async function StatementsPage() {
  if (!isFinancialStatementsEnabled()) notFound();

  const statements = await getStatements();

  return (
    <div>
      <StatementsTabs />
      <PageHeader
        title="Statements"
        subtitle="Factual, period-scoped records of your financial activity, generated from your OneLedger ledger. Not an official statement from your provider."
        action={generateCta}
      />

      {statements.length === 0
        ? (
          <EmptyState
            variant="setup"
            title="No statements yet"
            description="Generate your first statement from your OneLedger financial activity."
            action={generateCta}
          />
        )
        : (
          <ul className="flex flex-col gap-3">
            {statements.map((s) => {
              const period = reconstructStatementPeriod(
                new Date(s.period_start),
                new Date(s.period_end),
                s.timezone,
              );
              return (
                <li key={s.id}>
                  <Link
                    href={`/reports/statements/${s.id}`}
                    className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">
                        {period.label}
                      </span>
                      <StatementStatusBadge status={s.status} />
                      {s.supersedes_id && (
                        <span className="text-xs text-text-muted">
                          updated version
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted">
                      {SCOPE_LABEL[s.scope]} ·{" "}
                      {s.statement_type === "detailed"
                        ? "Detailed"
                        : "Standard"} · {s.transaction_count}{" "}
                      {s.transaction_count === 1
                        ? "transaction"
                        : "transactions"}
                      {s.generated_at
                        ? ` · Generated ${
                          formatZonedDateTime(s.generated_at, s.timezone)
                        }`
                        : ""}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
