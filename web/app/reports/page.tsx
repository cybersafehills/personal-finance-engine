import Link from "next/link";
import { getReportRuns } from "../../lib/queries";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { ReportStatusBadge } from "../../components/ReportStatusBadge";
import { formatZonedDate, formatZonedDateTime } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const reports = await getReportRuns();

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Your daily financial reports"
        action={
          <Link
            href="/settings/reports"
            className="text-sm font-medium text-accent hover:underline"
          >
            Settings
          </Link>
        }
      />

      {reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description="Turn on daily reports in Settings to start receiving a financial summary each morning."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((report) => (
            <Link
              key={report.id}
              href={`/reports/${report.id}`}
              className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {formatZonedDate(report.period_start, report.timezone)}
                </span>
                <ReportStatusBadge status={report.status} />
              </div>
              <p className="text-xs text-text-muted">
                {report.generated_at
                  ? `Generated ${formatZonedDateTime(report.generated_at, report.timezone)}`
                  : "Not yet generated"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
