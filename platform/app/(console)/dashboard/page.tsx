import Link from "next/link";
import { BarChart } from "../../../components/ui/BarChart";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  Segmented,
  StatusPill,
  Unavailable,
  type Tone,
} from "../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../lib/console/access";
import { can } from "../../../lib/console/permissions";
import { ROLE_LABELS, isRole } from "../../../lib/console/permissions";
import {
  describeDelta,
  formatCount,
  formatDateTime,
  PLAN_LABELS,
} from "../../../lib/format";
import {
  assessOperationalHealth,
  type OperationalHealthSnapshot,
  type OperationalHealthStatus,
} from "../../../lib/operational-health";

export const metadata = { title: "Executive Dashboard" };

type Summary = {
  window_days: number;
  generated_at: string;
  registrations: { current: number; previous: number; total: number; suspended: number };
  active_workspaces: { current: number; previous: number; total: number };
  registrations_by_day: { day: string; count: number }[];
  plan_distribution: { plan: string; count: number }[];
};
type FeedRow = {
  occurred_at: string;
  event_type: "registration" | "admin_action";
  event: string;
  category: string;
  subject: string;
  status: string;
  operator_role: string | null;
};

const RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
];

const HEALTH_TONE: Record<OperationalHealthStatus, Tone> = {
  healthy: "positive",
  attention: "attention",
  critical: "danger",
  insufficient_data: "neutral",
};
const HEALTH_LABEL: Record<OperationalHealthStatus, string> = {
  healthy: "Operational",
  attention: "Degraded",
  critical: "Incident",
  insufficient_data: "Unknown",
};
const STATUS_TONE: Record<string, Tone> = {
  completed: "positive",
  success: "positive",
  restricted: "attention",
  denied: "danger",
  failed: "danger",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireSession();
  const { days: daysParam } = await searchParams;
  const days = RANGES.some((r) => r.key === daysParam) ? Number(daysParam) : 30;

  const wantsHealth = can(session.access, "view_system_health");
  const [summary, feed, health] = await Promise.all([
    consoleRpc<Summary>(session, "console_dashboard_summary", { p_days: days }),
    consoleRpc<FeedRow[]>(session, "console_activity_feed", { p_limit: 12 }),
    wantsHealth
      ? consoleRpc<OperationalHealthSnapshot>(session, "console_health_snapshot", {
          p_window_minutes: 60,
        })
      : Promise.resolve(null),
  ]);

  const assessment =
    health && health.ok ? assessOperationalHealth(health.data) : null;
  const s = summary.ok ? summary.data : null;

  const regDelta = s ? describeDelta(s.registrations.current, s.registrations.previous) : undefined;
  const actDelta = s ? describeDelta(s.active_workspaces.current, s.active_workspaces.previous) : undefined;
  const planTotal = s ? s.plan_distribution.reduce((a, b) => a + b.count, 0) : 0;

  const attention = assessment
    ? (Object.entries(assessment.domains) as [string, OperationalHealthStatus][]).filter(
        ([, v]) => v === "attention" || v === "critical",
      )
    : [];

  return (
    <>
      <PageHeader
        title="Executive Dashboard"
        subtitle="Platform-wide aggregates. No customer financial data is shown here."
        actions={
          <Segmented
            label="Date range"
            active={String(days)}
            items={RANGES.map((r) => ({ key: r.key, label: r.label, href: `/dashboard?days=${r.key}` }))}
          />
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {s ? (
          <KpiCard
            label="Registered customers"
            value={formatCount(s.registrations.total)}
            delta={regDelta}
            hint={`${formatCount(s.registrations.current)} new in ${days} d · prior ${days} d: ${formatCount(s.registrations.previous)}`}
            help="Profiles in the platform. New = profiles created in the selected range; delta compares with the equal-length range before it."
          />
        ) : (
          <KpiCard label="Registered customers" value="—" hint="Unavailable" />
        )}

        <KpiCard
          label="Subscription revenue"
          value="Not connected"
          hint="No subscription billing source exists yet"
          help="OneLedger does not yet record paid subscriptions or payments, so collections and recurring revenue cannot be calculated. Nothing is estimated."
        />

        {s ? (
          <KpiCard
            label="Customer activity"
            value={formatCount(s.active_workspaces.current)}
            delta={actDelta}
            hint={`active workspaces · of ${formatCount(s.active_workspaces.total)}`}
            help="Active workspace = a workspace with at least one transaction recorded in the selected range."
          />
        ) : (
          <KpiCard label="Customer activity" value="—" hint="Unavailable" />
        )}

        {assessment ? (
          <KpiCard
            label="Platform health"
            value={
              <StatusPill tone={HEALTH_TONE[assessment.overall]}>
                {HEALTH_LABEL[assessment.overall]}
              </StatusPill>
            }
            hint="Last 60 min · ingestion, jobs, email, reconciliation"
            href="/platform/health"
            help="Worst status across monitored pipelines. 'Unknown' means there was too little activity to judge - it is not shown as Operational."
          />
        ) : (
          <KpiCard
            label="Platform health"
            value="—"
            hint={wantsHealth ? "Unavailable" : "Not in your role's scope"}
          />
        )}
      </div>

      {/* Primary row */}
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="Platform Activity" subtitle="Most recent registrations and administrative actions">
          {feed.ok ? (
            feed.data.length === 0 ? (
              <EmptyState message="No activity recorded yet." />
            ) : (
              <DataTable
                caption="Recent platform activity"
                columns={["Time", "Event", "Subject", "Category", "Status", "Operator"]}
              >
                {feed.data.map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-2 py-2 text-text-2">{formatDateTime(r.occurred_at)}</td>
                    <td className="px-2 py-2 capitalize">{r.event}</td>
                    <td className="px-2 py-2 font-mono text-xs text-text-2">{r.subject}</td>
                    <td className="px-2 py-2 text-text-2">{r.category}</td>
                    <td className="px-2 py-2">
                      <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill>
                    </td>
                    <td className="px-2 py-2 text-xs text-text-3">
                      {r.operator_role && isRole(r.operator_role) ? ROLE_LABELS[r.operator_role] : "—"}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )
          ) : (
            <ErrorState message="Activity could not be loaded." />
          )}
        </Card>

        <Card title="Activity Intelligence" subtitle={`New registrations per day · last ${days} days (Kigali time)`}>
          {s ? (
            <>
              <BarChart
                points={s.registrations_by_day.map((d) => ({ label: d.day, value: d.count }))}
                summary={`New registrations per day over ${days} days, ${s.registrations.current} in total.`}
              />
              <div className="mt-3 border-t border-border pt-3 text-xs text-text-2">
                <p className="font-medium text-text">Observation</p>
                <p className="mt-1">
                  {observation(s, days)}
                </p>
                <p className="mt-1 text-text-3">
                  Calculated from profile creation dates: current range vs the equal-length range before it.
                </p>
              </div>
            </>
          ) : (
            <ErrorState message="Chart data could not be loaded." />
          )}
        </Card>
      </div>

      {/* Bottom modules */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card title="Revenue Calendar" subtitle="Daily subscription collections">
          <Unavailable
            title="No billing source connected"
            reason="Subscription payments are not recorded in OneLedger yet, so there are no collections to plot. This will populate once billing is implemented."
          />
        </Card>

        <Card title="Subscription Distribution" subtitle="Assigned plan tier per workspace">
          {s ? (
            s.plan_distribution.length === 0 ? (
              <EmptyState message="No workspaces yet." />
            ) : (
              <>
                <ul className="space-y-2">
                  {s.plan_distribution.map((p) => {
                    const pct = planTotal > 0 ? (p.count / planTotal) * 100 : 0;
                    return (
                      <li key={p.plan}>
                        <div className="flex justify-between text-xs">
                          <span>{PLAN_LABELS[p.plan] ?? p.plan}</span>
                          <span className="text-text-2">
                            {formatCount(p.count)} · {pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-xs text-text-3">
                  These are assigned tiers, not paying subscribers - there is no billing record behind them.
                </p>
              </>
            )
          ) : (
            <ErrorState message="Distribution could not be loaded." />
          )}
        </Card>

        <Card title="Executive Action Queue" subtitle="Items that need an operator">
          {assessment ? (
            attention.length > 0 ? (
              <ul className="space-y-2">
                {attention.map(([domain, status]) => (
                  <li key={domain} className="flex items-center justify-between gap-2 rounded-control bg-surface-muted px-3 py-2 text-sm">
                    <span className="capitalize">{domain} pipeline</span>
                    <span className="flex items-center gap-2">
                      <StatusPill tone={HEALTH_TONE[status]}>{HEALTH_LABEL[status]}</StatusPill>
                      <Link href="/platform/health" className="text-xs text-accent underline">
                        Review
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="Nothing needs attention right now." />
            )
          ) : (
            <Unavailable
              title="No actionable sources in scope"
              reason={
                wantsHealth
                  ? "The health snapshot could not be loaded."
                  : "Your role does not include system health."
              }
            />
          )}
          <p className="mt-3 text-xs text-text-3">
            Approvals, payment-failure investigations and support escalations will appear here when those modules ship.
          </p>
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
  return `Registrations are ${d.direction === "up" ? "up" : d.direction === "down" ? "down" : "unchanged"} (${d.text}): ${formatCount(current)} vs ${formatCount(previous)} in the prior ${days} days.`;
}
