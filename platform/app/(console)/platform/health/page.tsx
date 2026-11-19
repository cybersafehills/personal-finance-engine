import {
  Card,
  DataTable,
  ErrorState,
  PageHeader,
  StatusPill,
  Unavailable,
  type Tone,
} from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { can } from "../../../../lib/console/permissions";
import { formatCount, formatDateTime } from "../../../../lib/format";
import {
  assessOperationalHealth,
  type OperationalHealthSnapshot,
  type OperationalHealthStatus,
} from "../../../../lib/operational-health";

export const metadata = { title: "System Health" };

const TONE: Record<OperationalHealthStatus, Tone> = {
  healthy: "positive", attention: "attention", critical: "danger", insufficient_data: "neutral",
};
const LABEL: Record<OperationalHealthStatus, string> = {
  healthy: "Operational", attention: "Degraded", critical: "Incident", insufficient_data: "Unknown",
};
const DOMAINS: Record<string, string> = {
  ingestion: "Transaction ingestion (SMS/email pipeline)",
  duplicates: "Duplicate review queue",
  jobs: "Scheduled report jobs",
  email: "Transactional email delivery",
  reconciliation: "Balance reconciliation",
};

export default async function HealthPage() {
  const session = await requireSession();
  if (!can(session.access, "view_system_health")) {
    return (
      <>
        <PageHeader title="System Health" />
        <ErrorState message="Your role does not include system health." />
      </>
    );
  }
  const res = await consoleRpc<OperationalHealthSnapshot>(session, "console_health_snapshot", {
    p_window_minutes: 60,
  });
  if (!res.ok) {
    return (
      <>
        <PageHeader title="System Health" />
        <ErrorState message="The health snapshot could not be loaded." />
      </>
    );
  }
  const snap = res.data;
  const a = assessOperationalHealth(snap);
  const detail: Record<string, string> = {
    ingestion: `${formatCount(snap.ingestion.received)} received · ${formatCount(snap.ingestion.failed)} failed · ${formatCount(snap.ingestion.stale_processing_backlog + snap.ingestion.raw_event_pending_backlog)} backlog`,
    duplicates: `${formatCount(snap.duplicates.review_backlog)} awaiting review · oldest ${Math.round(snap.duplicates.oldest_review_age_seconds / 3600)} h`,
    jobs: `${formatCount(snap.jobs.report_runs_failed)} failed runs · ${formatCount(snap.jobs.report_runs_overdue)} overdue · ${formatCount(snap.jobs.report_deliveries_failed)} failed deliveries`,
    email: `${formatCount(snap.email.attempted)} attempted · ${formatCount(snap.email.failed)} failed · ${formatCount(snap.email.pending_outbox)} pending`,
    reconciliation: `${formatCount(snap.reconciliation.created)} created · ${formatCount(snap.reconciliation.conflicts)} conflicts · ${formatCount(snap.reconciliation.review_backlog)} awaiting review`,
  };
  return (
    <>
      <PageHeader
        title="System Health"
        subtitle={`Aggregate pipeline snapshot, last ${snap.window_minutes} minutes · captured ${formatDateTime(snap.captured_at)}`}
        actions={<StatusPill tone={TONE[a.overall]}>{LABEL[a.overall]}</StatusPill>}
      />
      <Card title="Monitored pipelines" subtitle="'Unknown' = too little activity in the window to judge; it is never shown as Operational.">
        <DataTable caption="Pipeline health" columns={["Pipeline", "Status", "Detail"]}>
          {Object.entries(a.domains).map(([k, v]) => (
            <tr key={k}>
              <td className="px-2 py-2">{DOMAINS[k] ?? k}</td>
              <td className="px-2 py-2"><StatusPill tone={TONE[v]}>{LABEL[v]}</StatusPill></td>
              <td className="px-2 py-2 text-xs text-text-2">{detail[k]}</td>
            </tr>
          ))}
        </DataTable>
      </Card>
      <div className="mt-4">
        <Unavailable
          title="Not monitored yet"
          reason="Application availability, API latency, authentication-service status and deployment health have no telemetry source wired to the console, so they are not shown."
        />
      </div>
    </>
  );
}
