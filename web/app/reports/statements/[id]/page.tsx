import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { StatementsTabs } from "../../../../components/StatementsTabs";
import { StatementStatusBadge } from "../../../../components/StatementStatusBadge";
import { StatementActions } from "../../../../components/StatementActions";
import { isFinancialStatementsEnabled } from "../../../../lib/financial-statements";
import {
  getActiveWorkspace,
  getStatementDetail,
  type StatementLine,
} from "../../../../lib/queries";
import { reconstructStatementPeriod } from "../../../../lib/statement-period";
import {
  formatStatementAmount,
  formatStatementSignedAmount,
  statementDateKey,
} from "../../../../lib/statement-document";
import { formatZonedDateTime } from "../../../../lib/format";

export const dynamic = "force-dynamic";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-card border border-border-subtle bg-surface p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-1.5 text-sm last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="tabular-nums text-text-primary">{value}</span>
    </div>
  );
}

export default async function StatementDetailPage(
  { params }: PageProps<"/reports/statements/[id]">,
) {
  if (!isFinancialStatementsEnabled()) notFound();

  const { id } = await params;
  const [statement, workspace] = await Promise.all([
    getStatementDetail(id),
    getActiveWorkspace(),
  ]);
  if (!statement) notFound();

  const canManage = workspace ? workspace.role !== "viewer" : false;
  const period = reconstructStatementPeriod(
    new Date(statement.period_start),
    new Date(statement.period_end),
    statement.timezone,
  );
  const currency = statement.currency;
  const amount = (minor: number | null) =>
    minor === null ? "—" : formatStatementAmount(minor, currency);
  const mixed = !!statement.per_currency && statement.per_currency.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <StatementsTabs />
      <PageHeader
        backHref="/reports/statements"
        backLabel="Statements"
        title={period.label}
        subtitle={`${
          statement.scope === "filtered"
            ? "Filtered statement"
            : statement.scope === "all_accounts"
            ? "Consolidated statement"
            : "Account statement"
        } · ${
          statement.statement_type === "detailed" ? "Detailed" : "Standard"
        }`}
        action={<StatementStatusBadge status={statement.status} />}
      />

      {statement.status === "failed" && (
        <EmptyState
          title="This statement could not be generated"
          description={statement.failure_reason ??
            "An unexpected error occurred."}
        />
      )}

      <StatementActions
        statementUuid={statement.id}
        status={statement.status}
        canManage={canManage}
      />

      <Section title="Financial summary">
        {mixed && statement.per_currency
          ? (
            <div className="flex flex-col gap-4">
              {statement.per_currency.map((c) => (
                <div key={c.currency}>
                  <p className="mb-1 text-sm font-medium text-text-primary">
                    {c.currency}
                  </p>
                  <SummaryRow
                    label="Opening balance"
                    value={c.openingBalanceMinor === null
                      ? "—"
                      : formatStatementAmount(
                        c.openingBalanceMinor,
                        c.currency,
                      )}
                  />
                  <SummaryRow
                    label="Money in"
                    value={formatStatementAmount(
                      c.totalCreditsMinor,
                      c.currency,
                    )}
                  />
                  <SummaryRow
                    label="Money out"
                    value={formatStatementAmount(
                      c.totalDebitsMinor,
                      c.currency,
                    )}
                  />
                  <SummaryRow
                    label="Fees"
                    value={formatStatementAmount(c.totalFeesMinor, c.currency)}
                  />
                  <SummaryRow
                    label="Closing balance"
                    value={c.closingBalanceMinor === null
                      ? "—"
                      : formatStatementAmount(
                        c.closingBalanceMinor,
                        c.currency,
                      )}
                  />
                </div>
              ))}
            </div>
          )
          : (
            <div>
              <SummaryRow
                label="Opening balance"
                value={amount(statement.opening_balance_minor)}
              />
              <SummaryRow
                label="Money in"
                value={formatStatementAmount(
                  statement.total_credit_minor,
                  currency,
                )}
              />
              <SummaryRow
                label="Money out"
                value={formatStatementAmount(
                  statement.total_debit_minor,
                  currency,
                )}
              />
              <SummaryRow
                label="Fees / charges"
                value={formatStatementAmount(
                  statement.total_fees_minor,
                  currency,
                )}
              />
              <SummaryRow
                label="Net movement"
                value={formatStatementSignedAmount(
                  statement.total_credit_minor - statement.total_debit_minor -
                    statement.total_fees_minor,
                  currency,
                )}
              />
              <SummaryRow
                label="Closing balance"
                value={amount(statement.closing_balance_minor)}
              />
              <SummaryRow
                label="Transactions"
                value={`${statement.transaction_count}`}
              />
            </div>
          )}
        {statement.reconciles === false && (
          <p className="mt-3 rounded-control bg-attention-bg px-3 py-2 text-xs text-attention">
            The balances don&apos;t reconcile against the transactions in this
            period — one or more may be missing from OneLedger&apos;s records.
          </p>
        )}
      </Section>

      <Section title="Source & coverage">
        <p className="text-sm text-text-primary">
          {statement.source_metadata?.summaryLabel ??
            "Financial activity recorded in OneLedger"}
        </p>
        <p className="mt-1 text-sm text-text-muted">
          {statement.coverage_metadata?.statementLabel ??
            "Complete for the financial records available to OneLedger."}
        </p>
        {statement.coverage_metadata?.filtered &&
          statement.coverage_metadata?.filterSummary && (
          <p className="mt-1 text-sm font-medium text-text-secondary">
            Scope: {statement.coverage_metadata.filterSummary}
          </p>
        )}
        {(statement.coverage_metadata?.warnings ?? []).map((w, i) => (
          <p key={i} className="mt-1 text-xs text-text-muted">• {w.detail}</p>
        ))}
      </Section>

      <Section title="Transactions">
        {statement.sampleLines.length === 0
          ? (
            <p className="text-sm text-text-muted">
              No transactions in this period.
            </p>
          )
          : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-xs">
                  <thead className="text-text-muted">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Date</th>
                      <th className="py-1 pr-2 font-medium">Description</th>
                      <th className="py-1 pr-2 text-right font-medium">In</th>
                      <th className="py-1 pr-2 text-right font-medium">Out</th>
                      <th className="py-1 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="text-text-secondary">
                    {statement.sampleLines.map((line: StatementLine, i) => (
                      <tr key={i} className="border-t border-border-subtle">
                        <td className="py-1 pr-2 tabular-nums">
                          {statementDateKey(
                            line.occurred_at,
                            statement.timezone,
                          )}
                        </td>
                        <td className="py-1 pr-2">
                          {line.display_description ?? "—"}
                          {line.original_description && (
                            <span className="block text-text-muted">
                              {line.original_description}
                            </span>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {line.direction === "in"
                            ? formatStatementAmount(
                              line.principal_effect_minor ?? 0,
                              currency,
                            )
                            : ""}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {line.direction === "out"
                            ? formatStatementAmount(
                              line.principal_effect_minor ?? 0,
                              currency,
                            )
                            : ""}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {line.running_balance_minor === null
                            ? "—"
                            : formatStatementAmount(
                              line.running_balance_minor,
                              currency,
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {statement.sampleTruncated && (
                <p className="mt-2 text-xs text-text-muted">
                  Showing the first {statement.sampleLines.length} of{" "}
                  {statement.transaction_count}. Download the statement for the
                  full list.
                </p>
              )}
            </>
          )}
      </Section>

      <p className="px-1 text-center text-xs text-text-muted">
        {statement.statement_id} · Generated {statement.generated_at
          ? formatZonedDateTime(statement.generated_at, statement.timezone)
          : "—"}{" "}
        · Generated by OneLedger and not an official statement issued by the
        originating financial provider.
      </p>
    </div>
  );
}
