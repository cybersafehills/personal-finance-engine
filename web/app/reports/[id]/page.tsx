import { notFound } from "next/navigation";
import { getReportRunById } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { StatTile } from "../../../components/StatTile";
import { MoneyAmount } from "../../../components/MoneyAmount";
import { ReportStatusBadge } from "../../../components/ReportStatusBadge";
import { AllocationActualsCard } from "../../../components/AllocationActualsCard";
import { ReportTrendsList } from "../../../components/ReportTrendsList";
import { ReportWatchOutsList } from "../../../components/ReportWatchOutsList";
import { formatRwf } from "../../../lib/format";
import { formatZonedDate, formatZonedDateTime } from "../../../lib/format";

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

export default async function ReportDetailPage({
  params,
}: PageProps<"/reports/[id]">) {
  const { id } = await params;
  const report = await getReportRunById(id);

  if (!report) {
    notFound();
  }

  const dateLabel = formatZonedDate(report.period_start, report.timezone);
  const payload = report.report_payload;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        backHref="/reports"
        title={dateLabel}
        subtitle={`Daily financial report · ${report.timezone}`}
        action={<ReportStatusBadge status={report.status} />}
      />

      {report.status === "generation_failed" && (
        <EmptyState
          title="This report could not be generated"
          description={report.error_message ?? "An unexpected error occurred."}
        />
      )}

      {!payload && report.status !== "generation_failed" && (
        <EmptyState
          title="Report not yet available"
          description="This report hasn't been generated yet - check back after its scheduled generation time."
        />
      )}

      {payload && (
        <>
          <section className="rounded-card border border-border-subtle bg-surface px-6 py-7 text-center">
            <p className="text-sm font-medium text-text-muted">Closing balance</p>
            <div className="mt-2">
              {payload.financialSnapshot.closingBalanceRwf !== null ? (
                <span className="text-4xl font-semibold tabular-nums text-text-primary">
                  {formatRwf(payload.financialSnapshot.closingBalanceRwf)}
                </span>
              ) : (
                <span className="text-4xl font-semibold text-text-muted">—</span>
              )}
            </div>
            <div className="mt-3">
              <MoneyAmount amountRwf={payload.financialSnapshot.netMovementRwf} size="md" />
              <span className="ml-1 text-sm text-text-muted">net movement</span>
            </div>
          </section>

          <Section title="Today's activity">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                label="Received"
                value={formatRwf(payload.financialSnapshot.moneyReceivedRwf)}
              />
              <StatTile
                label="Spent"
                value={formatRwf(payload.financialSnapshot.moneySpentRwf)}
              />
              <StatTile label="Fees" value={formatRwf(payload.financialSnapshot.feesRwf)} />
              <StatTile
                label="Transactions"
                value={`${payload.financialSnapshot.transactionCount}`}
              />
              {payload.financialSnapshot.largestOutflowRwf !== null && (
                <StatTile
                  label="Largest outflow"
                  value={formatRwf(payload.financialSnapshot.largestOutflowRwf)}
                />
              )}
              {payload.financialSnapshot.largestInflowRwf !== null && (
                <StatTile
                  label="Largest inflow"
                  value={formatRwf(payload.financialSnapshot.largestInflowRwf)}
                />
              )}
            </div>
          </Section>

          <Section title="Spending breakdown">
            {payload.categoryTotals.length === 0 ? (
              <p className="text-sm text-text-muted">No spending recorded for this day.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {payload.categoryTotals.map((category) => (
                  <div key={category.category} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-text-primary">
                        {category.category}
                      </span>
                      <span className="tabular-nums text-text-secondary">
                        {formatRwf(category.amountRwf)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-background">
                      <div
                        className={`h-full ${
                          category.category === "Uncategorized" ? "bg-attention" : "bg-accent"
                        }`}
                        style={{ width: `${Math.max(category.percentOfSpending, 2)}%` }}
                      />
                    </div>
                    <span className="text-xs text-text-muted">
                      {category.transactionCount}{" "}
                      {category.transactionCount === 1 ? "transaction" : "transactions"} ·{" "}
                      {Math.round(category.percentOfSpending)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Budget health">
            {payload.budget.overallStatus === "no_active_budget" ? (
              <p className="text-sm text-text-muted">No active RWF budget for this period.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {payload.budget.allocations.map((allocation) => (
                  <AllocationActualsCard
                    key={allocation.allocationType}
                    actual={allocation}
                    currency="RWF"
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="Trends">
            <ReportTrendsList trends={payload.trends} />
          </Section>

          <Section title="Watch-outs">
            <ReportWatchOutsList
              reportAlerts={payload.alerts}
              budgetAlerts={payload.budget.overallStatus === "no_active_budget"
                ? []
                : payload.budget.alerts}
            />
          </Section>

          <Section title="Outlook">
            {payload.forecast ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-text-primary">
                  At the current pace, this month&apos;s spending is projected to reach{" "}
                  <span className="font-semibold">
                    {formatRwf(Math.round(payload.forecast.projectedMonthEndSpendRwf))}
                  </span>{" "}
                  by month end.
                </p>
                <p className="text-xs text-text-muted">{payload.forecast.disclaimer}</p>
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                Not enough history yet for a month-end projection.
              </p>
            )}
          </Section>

          <p className="px-1 text-center text-xs text-text-muted">
            Reporting period: {formatZonedDate(report.period_start, report.timezone)} ·
            Generated{" "}
            {report.generated_at
              ? formatZonedDateTime(report.generated_at, report.timezone)
              : "—"}
          </p>
        </>
      )}
    </div>
  );
}
