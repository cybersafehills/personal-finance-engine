import Link from "next/link";
import {
  getActiveWorkspace,
  getReportPreferences,
  getReportRuns,
} from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { PageHeader } from "../../../components/PageHeader";
import { ReportPreferencesForm } from "../../../components/ReportPreferencesForm";
import { ReportStatusBadge } from "../../../components/ReportStatusBadge";
import { EmptyState } from "../../../components/EmptyState";
import { formatZonedDate, formatZonedDateTime } from "../../../lib/format";

export const dynamic = "force-dynamic";

// Folded into one settings destination (previously a separate top-level
// "Reports" entry in Settings, plus this "Daily reports" preferences
// page) - viewing and configuring the daily report are the same concern
// from a user's point of view, and splitting them was also how a
// preferences row silently ended up attached to the wrong workspace
// unnoticed (see the "Reporting for" line below): the settings and the
// list it produces were never shown together. `/reports` (the header
// icon / MoreSheet entry) still exists separately for quick access and
// still deliberately spans every workspace the user belongs to - only
// this settings page's own "Recent reports" is scoped to the one
// workspace being configured here.
const RECENT_REPORTS_LIMIT = 5;

export default async function ReportSettingsPage() {
  const [preferences, workspace, supabase] = await Promise.all([
    getReportPreferences(),
    getActiveWorkspace(),
    supabaseSession(),
  ]);
  const [
    {
      data: { user },
    },
    recentReports,
  ] = await Promise.all([
    supabase.auth.getUser(),
    workspace ? getReportRuns(RECENT_REPORTS_LIMIT, workspace.id) : Promise.resolve([]),
  ]);

  return (
    <div>
      <PageHeader
        backHref="/settings"
        title="Daily reports"
        subtitle="View your generated reports, and configure when the next one is generated and emailed"
      />

      {workspace && (
        <p className="mb-4 rounded-control bg-surface px-3 py-2 text-sm text-text-muted">
          Reporting for <span className="font-medium text-text-primary">{workspace.name}</span>.
          Switch workspaces to view or configure another workspace&apos;s report.
        </p>
      )}

      <ReportPreferencesForm preferences={preferences} suggestedEmail={user?.email ?? null} />

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-text-primary">Recent reports</h2>
          {recentReports.length > 0 && (
            <Link href="/reports" className="text-sm font-medium text-accent hover:underline">
              View all
            </Link>
          )}
        </div>

        {recentReports.length === 0 ? (
          <EmptyState
            title="No reports yet"
            description="Turn on the daily report above to start receiving a financial summary each morning."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {recentReports.map((report) => (
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
      </section>
    </div>
  );
}
