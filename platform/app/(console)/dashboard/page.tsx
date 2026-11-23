import Link from "next/link";
import { ColumnChart, ShareBars } from "../../../components/ui/charts";
import { Icon } from "../../../components/ui/Icon";
import {
  Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, Segmented, StatusPill, Unavailable, type Tone,
} from "../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../lib/console/access";
import { can, isRole, ROLE_LABELS } from "../../../lib/console/permissions";
import { describeDelta, formatCount, formatDateTime, humanizeAction, PLAN_LABELS } from "../../../lib/format";
import { assessOperationalHealth, type OperationalHealthSnapshot, type OperationalHealthStatus } from "../../../lib/operational-health";

export const metadata = { title: "Executive Dashboard" };

type Summary = {
  window_days: number;
  registrations: { current: number; previous: number; total: number; suspended: number };
  active_workspaces: { current: number; previous: number; total: number };
  registrations_by_day: { day: string; count: number }[];
  plan_distribution: { plan: string; count: number }[];
};
type FeedRow = { occurred_at: string; event_type: "registration" | "admin_action"; event: string; category: string; subject: string; status: string; operator_role: string | null };

const RANGES = [{ key: "7", label: "7 days" }, { key: "30", label: "30 days" }, { key: "90", label: "90 days" }];
const HEALTH_TONE: Record<OperationalHealthStatus, Tone> = { healthy: "positive", attention: "attention", critical: "danger", insufficient_data: "neutral" };
const HEALTH_LABEL: Record<OperationalHealthStatus, string> = { healthy: "Operational", attention: "Degraded", critical: "Incident", insufficient_data: "Unknown" };
const DOMAIN_LABEL: Record<string, string> = { ingestion: "Transaction ingestion", duplicates: "Duplicate review queue", jobs: "Scheduled report jobs", email: "Email delivery", reconciliation: "Balance reconciliation" };
const STATUS_TONE: Record<string, Tone> = { completed: "positive", success: "positive", restricted: "attention", denied: "danger", failed: "danger" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requireSession();
  const { days: daysParam } = await searchParams;
  const days = RANGES.some((r) => r.key === daysParam) ? Number(daysParam) : 30;

  const wantsHealth = can(session.access, "view_system_health");
  const [summary, feed, health] = await Promise.all([
    consoleRpc<Summary>(session, "console_dashboard_summary", { p_days: days }),
    consoleRpc<FeedRow[]>(session, "console_activity_feed", { p_limit: 8 }),
    wantsHealth ? consoleRpc<OperationalHealthSnapshot>(session, "console_health_snapshot", { p_window_minutes: 60 }) : Promise.resolve(null),
  ]);

  const assessment = health && health.ok ? assessOperationalHealth(health.data) : null;
  const s = summary.ok ? summary.data : null;
  const regDelta = s ? describeDelta(s.registrations.current, s.registrations.previous) : undefined;
  const actDelta = s ? describeDelta(s.active_workspaces.current, s.active_workspaces.previous) : undefined;
  const planTotal = s ? s.plan_distribution.reduce((a, b) => a + b.count, 0) : 0;
  const attention = assessment
    ? (Object.entries(assessment.domains) as [string, OperationalHealthStatus][]).filter(([, v]) => v === "attention" || v === "critical")
    : [];

  return (
    <>
      <PageHeader
        title="Executive Dashboard"
        subtitle="Platform-wide aggregates. No customer financial data is shown here."
        actions={<Segmented label="Date range" active={String(days)} items={RANGES.map((r) => ({ key: r.key, label: r.label, href: `/dashboard?days=${r.key}` }))} />}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {s ? (
          <KpiCard label="Registered customers" value={formatCount(s.registrations.total)} delta={regDelta}
            spark={s.registrations_by_day.map((d) => d.count)}
            hint={`${formatCount(s.registrations.current)} new · prior ${days} d: ${formatCount(s.registrations.previous)}`}
            href="/customers/users"
            help="Profiles on the platform. New = created in the selected range; the change compares it with the equal-length range before." />
        ) : <KpiCard label="Registered customers" value="—" hint="Unavailable" />}

        <KpiCard label="Subscription revenue" value={<span className="text-xl text-text-3">Not connected</span>}
          hint="No subscription billing source yet"
          help="OneLedger does not yet record paid subscriptions, so collections and recurring revenue cannot be calculated. Nothing is estimated." />

        {s ? (
          <KpiCard label="Customer activity" value={formatCount(s.active_workspaces.current)} delta={actDelta}
            hint={`active workspaces of ${formatCount(s.active_workspaces.total)}`}
            help="Active workspace = a workspace with at least one transaction recorded in the selected range." />
        ) : <KpiCard label="Customer activity" value="—" hint="Unavailable" />}

        {assessment ? (
          <KpiCard label="Platform health" value={<StatusPill tone={HEALTH_TONE[assessment.overall]}>{HEALTH_LABEL[assessment.overall]}</StatusPill>}
            tone={assessment.overall === "critical" ? "danger" : assessment.overall === "attention" ? "attention" : undefined}
            hint={attention.length ? `${attention.length} pipeline${attention.length > 1 ? "s" : ""} need review` : "All monitored pipelines normal"}
            href="/platform/health"
            help="Worst status across monitored pipelines over the last 60 minutes. 'Unknown' means too little activity to judge, never 'Operational'." />
        ) : <KpiCard label="Platform health" value="—" hint={wantsHealth ? "Unavailable" : "Not in your role's scope"} />}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card title="Platform Activity" subtitle="Latest registrations and administrative actions"
          action={<Link href="/overview/activity" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">View all <Icon name="right" size={13} /></Link>} padded={false}>
          {feed.ok ? (
            feed.data.length === 0 ? <EmptyState message="No activity recorded yet." /> : (
              <DataTable caption="Recent platform activity" columns={["Time", "Event", "Subject", "Status", "Operator"]}>
                {feed.data.map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{formatDateTime(r.occurred_at)}</td>
                    <td className="px-3 py-2.5">{r.event_type === "admin_action" ? humanizeAction(r.event) : r.event}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.subject}</td>
                    <td className="px-3 py-2.5"><StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill></td>
                    <td className="px-3 py-2.5 text-xs text-text-3">{r.operator_role && isRole(r.operator_role) ? ROLE_LABELS[r.operator_role] : "—"}</td>
                  </tr>
                ))}
              </DataTable>
            )
          ) : <div className="p-4"><ErrorState message="Activity could not be loaded." /></div>}
        </Card>

        <Card title="New registrations" subtitle={`Per day · last ${days} days (Kigali time)`}>
          {s ? (
            <>
              <ColumnChart points={s.registrations_by_day.map((d) => ({ label: d.day, value: d.count }))}
                summary={`New registrations per day over ${days} days, ${s.registrations.current} in total.`} />
              <div className="mt-3 rounded-control bg-surface-muted p-3 text-xs text-text-2">
                <p className="font-medium text-text">What this shows</p>
                <p className="mt-1">{observation(s, days)}</p>
              </div>
            </>
          ) : <ErrorState message="Chart data could not be loaded." />}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Revenue Calendar" subtitle="Daily subscription collections">
          <Unavailable title="No billing source connected" reason="Subscription payments are not recorded in OneLedger yet, so there are no collections to plot. This fills in once billing exists." />
        </Card>

        <Card title="Plan mix" subtitle="Assigned plan tier per workspace">
          {s ? (s.plan_distribution.length === 0 ? <EmptyState message="No workspaces yet." /> : (
            <ShareBars total={planTotal} items={s.plan_distribution.map((p) => ({ label: PLAN_LABELS[p.plan] ?? p.plan, value: p.count }))}
              note="Assigned tiers, not paying subscribers: there is no billing record behind them." />
          )) : <ErrorState message="Plan mix could not be loaded." />}
        </Card>

        <Card title="Needs attention" subtitle="Items that need an operator"
          action={attention.length ? <StatusPill tone="danger">{attention.length}</StatusPill> : undefined}>
          {assessment ? (attention.length > 0 ? (
            <ul className="space-y-2">
              {attention.map(([domain, status]) => (
                <li key={domain} className="flex items-center justify-between gap-2 rounded-control border border-border px-3 py-2 text-sm">
                  <span>{DOMAIN_LABEL[domain] ?? domain}</span>
                  <span className="flex items-center gap-2">
                    <StatusPill tone={HEALTH_TONE[status]}>{HEALTH_LABEL[status]}</StatusPill>
                    <Link href="/platform/health" className="text-xs font-medium text-accent hover:underline">Review</Link>
                  </span>
                </li>
              ))}
            </ul>
          ) : <EmptyState message="Nothing needs attention." hint="All monitored pipelines are normal." />) : (
            <Unavailable title="No actionable sources in scope" reason={wantsHealth ? "The health snapshot could not be loaded." : "Your role does not include system health."} />
          )}
          <p className="mt-3 text-xs text-text-3">Approvals, payment failures and support escalations will appear here when those modules ship.</p>
        </Card>
      </div>
    </>
  );
}

function observation(s: Summary, days: number): string {
  const { current, previous } = s.registrations;
  if (current === 0 && previous === 0) return `No registrations in the last ${days} days or the ${days} before.`;
  if (previous === 0) return `${formatCount(current)} registrations in the last ${days} days; none in the ${days} before, so no percentage is shown.`;
  const d = describeDelta(current, previous);
  return `Registrations are ${d.direction === "up" ? "up" : d.direction === "down" ? "down" : "unchanged"} (${d.text}): ${formatCount(current)} vs ${formatCount(previous)} in the prior ${days} days. Counted from profile creation dates.`;
}
