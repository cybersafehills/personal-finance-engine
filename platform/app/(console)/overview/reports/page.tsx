import { ColumnChart, Funnel, ShareBars } from "../../../../components/ui/charts";
import { Card, ErrorState, PageHeader, Unavailable } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { formatCount, PLAN_LABELS } from "../../../../lib/format";

export const metadata = { title: "Reports & Intelligence" };

type Report = {
  registrations_by_month: { month: string; count: number }[];
  funnel: { step: string; count: number }[];
  workspace_kinds: { kind: string; count: number }[];
  plan_distribution: { plan: string; count: number }[];
};
const STEP: Record<string, { label: string; hint: string }> = {
  registered: { label: "Registered", hint: "A profile exists" },
  email_confirmed: { label: "Email confirmed", hint: "Customer verified their address" },
  onboarding_completed: { label: "Onboarding completed", hint: "Finished the guided setup" },
  account_added: { label: "Account added", hint: "At least one money account in a workspace" },
  first_transaction: { label: "First transaction", hint: "A transaction has been recorded" },
};

export default async function ReportsPage() {
  const session = await requireSession();
  const res = await consoleRpc<Report>(session, "console_reports_overview", { p_months: 12 });
  if (!res.ok) return (<><PageHeader title="Reports & Intelligence" /><ErrorState message="The report could not be loaded." /></>);
  const r = res.data;
  const total = r.registrations_by_month.reduce((a, b) => a + b.count, 0);
  const planTotal = r.plan_distribution.reduce((a, b) => a + b.count, 0);
  const kindTotal = r.workspace_kinds.reduce((a, b) => a + b.count, 0);
  return (
    <>
      <PageHeader title="Reports & Intelligence" subtitle="Growth and activation, from counts only. Every figure is a count of platform records; nothing is estimated." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Registrations by month" subtitle={`Last 12 months · ${formatCount(total)} in total (Kigali time)`}>
          <ColumnChart points={r.registrations_by_month.map((m) => ({ label: m.month, value: m.count }))} summary={`Registrations per month over 12 months, ${total} in total.`} />
        </Card>
        <Card title="Activation funnel" subtitle="How far registered customers get">
          <Funnel steps={r.funnel.map((f) => ({ label: STEP[f.step]?.label ?? f.step, hint: STEP[f.step]?.hint, value: f.count }))} />
        </Card>
        <Card title="Workspace types" subtitle="Personal vs business">
          <ShareBars total={kindTotal} items={r.workspace_kinds.map((k) => ({ label: k.kind === "organization" ? "Organization" : "Personal", value: k.count }))} />
        </Card>
        <Card title="Plan mix" subtitle="Assigned tier per workspace">
          <ShareBars total={planTotal} items={r.plan_distribution.map((p) => ({ label: PLAN_LABELS[p.plan] ?? p.plan, value: p.count }))} note="Assigned tiers, not paying subscribers." />
        </Card>
      </div>
      <div className="mt-4">
        <Unavailable title="Revenue, churn and retention reports" reason="These need subscription billing records, which do not exist yet. They will appear here once billing is implemented." />
      </div>
    </>
  );
}
