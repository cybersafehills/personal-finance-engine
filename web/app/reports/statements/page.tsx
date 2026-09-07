import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { StatementsTabs } from "../../../components/StatementsTabs";
import { StatementStatusBadge } from "../../../components/StatementStatusBadge";
import { CreatePackForm } from "../../../components/CreatePackForm";
import { StatementPackDelete } from "../../../components/StatementPackDelete";
import { StatementScheduleForm } from "../../../components/StatementScheduleForm";
import { ProviderStatements } from "../../../components/ProviderStatements";
import { isFinancialStatementsEnabled } from "../../../lib/financial-statements";
import { getProviderStatements } from "../../../lib/provider-statements";
import {
  getStatementPacks,
  getStatements,
  type StatementScopeName,
} from "../../../lib/queries";
import { getStatementFormOptions } from "../../../lib/statement-generation";
import { getStatementSchedules } from "../../../lib/statement-schedule";
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

  const [statements, packs, schedules, formOptions, providerDocs] = await Promise
    .all([
      getStatements(),
      getStatementPacks(),
      getStatementSchedules(),
      getStatementFormOptions(),
      getProviderStatements(),
    ]);
  const readyStatements = statements
    .filter((s) => s.status === "ready")
    .map((s) => {
      const period = reconstructStatementPeriod(
        new Date(s.period_start),
        new Date(s.period_end),
        s.timezone,
      );
      return { id: s.id, label: `${period.label} · ${s.statement_id}` };
    });

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

      <details className="mt-6 rounded-card border border-border-subtle bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-medium text-text-primary">
          Financial packs
          <span className="ml-2 font-normal text-text-muted">
            bundle several statements into one ZIP
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          {packs.length > 0 && (
            <ul className="flex flex-col gap-2">
              {packs.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 rounded-control border border-border-subtle bg-background px-3 py-2 text-sm"
                >
                  <span className="font-medium text-text-primary">
                    {p.title || p.pack_id}
                  </span>
                  <span className="text-xs text-text-muted">
                    {p.item_count}{" "}
                    {p.item_count === 1 ? "statement" : "statements"}
                    {p.status !== "ready" ? ` · ${p.status}` : ""}
                  </span>
                  {p.status === "ready" && (
                    <a
                      href={`/api/reports/statements/packs/${p.id}`}
                      className="ml-auto text-xs font-medium text-accent"
                    >
                      Download ZIP
                    </a>
                  )}
                  <StatementPackDelete packUuid={p.id} />
                </li>
              ))}
            </ul>
          )}
          <CreatePackForm statements={readyStatements} />
        </div>
      </details>

      <details className="mt-4 rounded-card border border-border-subtle bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-medium text-text-primary">
          Scheduled statements
          <span className="ml-2 font-normal text-text-muted">
            generate last month&apos;s statement automatically
          </span>
        </summary>
        <div className="mt-3">
          {formOptions.ok
            ? (
              <StatementScheduleForm
                sources={formOptions.sources.map((s) => ({
                  id: s.id,
                  label: s.label,
                }))}
                defaultTimezone={formOptions.timezone}
                schedules={schedules.map((s) => ({
                  id: s.id,
                  statement_type: s.statement_type,
                  account_ids: s.account_ids,
                  cadence: s.cadence,
                  day_of_month: s.day_of_month,
                  day_of_week: s.day_of_week,
                  next_run_at: s.next_run_at,
                }))}
              />
            )
            : (
              <p className="text-text-muted">
                Scheduling isn&apos;t available in this space.
              </p>
            )}
        </div>
      </details>

      <details className="mt-4 rounded-card border border-border-subtle bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-medium text-text-primary">
          Provider statements
          <span className="ml-2 font-normal text-text-muted">
            store the original documents your bank or wallet issued
          </span>
        </summary>
        <div className="mt-3">
          <ProviderStatements
            documents={providerDocs}
            sources={formOptions.ok
              ? formOptions.sources.map((s) => ({ id: s.id, label: s.label }))
              : []}
          />
        </div>
      </details>

      <details className="mt-4 rounded-card border border-border-subtle bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-medium text-text-primary">
          About statements
        </summary>
        <div className="mt-3 flex flex-col gap-3 text-text-muted">
          <p>
            <span className="font-medium text-text-secondary">
              What is a OneLedger statement?
            </span>{" "}
            A document generated from the financial records available inside
            OneLedger for the account and period you choose — factual and
            reproducible, not an analysis.
          </p>
          <p>
            <span className="font-medium text-text-secondary">
              Is it an official bank statement?
            </span>{" "}
            No. It is generated by OneLedger and is not an official statement
            issued by your bank or mobile-money provider. Only a file the
            provider issued itself is that.
          </p>
          <p>
            <span className="font-medium text-text-secondary">
              Why might transactions be missing?
            </span>{" "}
            A connection interruption, a notification-capture gap, historical
            data that predates your setup, an incomplete import, or a filter you
            applied. The statement shows what coverage it can confirm and flags
            gaps it detects.
          </p>
          <p>
            <span className="font-medium text-text-secondary">
              Standard vs Detailed
            </span>{" "}
            Standard mirrors a conventional provider statement (date,
            description, reference, money in / out, balance). Detailed adds
            OneLedger enrichment such as the category, alongside the original
            provider information — it never replaces it.
          </p>
        </div>
      </details>
    </div>
  );
}
