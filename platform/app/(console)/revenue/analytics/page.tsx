import { ColumnChart, ShareBars } from "../../../../components/ui/charts";
import { Card, DataTable, EmptyState, ErrorState, PageHeader, Unavailable } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { formatRwf, humanizeAction, ratePercent } from "../../../../lib/format";

export const metadata = { title: "Revenue Analytics" };

type Res = {
  has_any_data: boolean;
  collected_by_month: { month: string; collected: number }[];
  by_plan: { plan: string; collected: number; payments: number }[];
  by_provider: { provider: string; succeeded: number; failed: number }[];
  new_by_month: { month: string; count: number }[];
  ended_by_month: { month: string; count: number }[];
};
const PLAN: Record<string, string> = { personal: "Personal", vip: "VIP", business: "Business" };

export default async function AnalyticsPage() {
  const session = await requireSession();
  const res = await consoleRpc<Res>(session, "console_billing_analytics", { p_months: 12 });
  if (!res.ok) return (<><PageHeader title="Revenue Analytics" /><ErrorState message="Analytics could not be loaded." /></>);
  const d = res.data;
  const total = d.collected_by_month.reduce((a, b) => a + b.collected, 0);
  const planTotal = d.by_plan.reduce((a, b) => a + b.collected, 0);
  const months = Array.from(new Set([...d.new_by_month, ...d.ended_by_month].map((x) => x.month))).sort();
  const get = (rows: { month: string; count: number }[], m: string) => rows.find((r) => r.month === m)?.count ?? 0;
  return (
    <>
      <PageHeader title="Revenue Analytics" subtitle="Cash collected, mix and subscription movement. Every figure is computed from the billing ledger; where there is no ledger data it says so." />
      {!d.has_any_data ? (
        <Unavailable title="No billing data yet" reason="No payment has been recorded, so there is nothing to analyse. Start a subscription and record its first payment under Subscriptions." />
      ) : null}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Collected by month" subtitle={`Net of refunds paid out · ${formatRwf(total)} over 12 months (Kigali time)`}>
          {d.has_any_data ? <ColumnChart points={d.collected_by_month.map((m) => ({ label: m.month, value: m.collected }))} unit=" RWF" summary={`Net collected revenue per month over 12 months, ${formatRwf(total)} in total.`} /> : <EmptyState message="No data." />}
        </Card>
        <Card title="Collected by plan" subtitle="All time, succeeded payments">
          {d.by_plan.length === 0 ? <EmptyState message="No settled payments yet." /> : (
            <ShareBars total={planTotal} items={d.by_plan.map((p) => ({ label: `${PLAN[p.plan] ?? p.plan} (${p.payments} payment${p.payments === 1 ? "" : "s"})`, value: p.collected }))} note="Amounts in RWF." />
          )}
        </Card>
        <Card title="By provider" subtitle="Settled payments only; pending ones are excluded from the rate" padded={false}>
          {d.by_provider.length === 0 ? <EmptyState message="No payments yet." /> : (
            <div className="p-1"><DataTable caption="Payments by provider" columns={["Provider", "Succeeded", "Failed", "Success rate"]}>
              {d.by_provider.map((p) => {
                const r = ratePercent(p.succeeded, p.succeeded + p.failed);
                return (<tr key={p.provider}><td className="px-3 py-2.5">{humanizeAction(p.provider)}</td><td className="px-3 py-2.5 tabular-nums">{p.succeeded}</td><td className="px-3 py-2.5 tabular-nums">{p.failed}</td><td className="px-3 py-2.5 tabular-nums">{r === null ? "No data" : `${r}%`}</td></tr>);
              })}
            </DataTable></div>
          )}
        </Card>
        <Card title="Subscription movement" subtitle="New subscriptions vs ended (cancelled or expired)" padded={false}>
          {months.length === 0 ? <EmptyState message="No movement yet." /> : (
            <div className="p-1"><DataTable caption="Subscription movement by month" columns={["Month", "New", "Ended", "Net"]}>
              {months.map((m) => (<tr key={m}><td className="px-3 py-2.5">{m}</td><td className="px-3 py-2.5 tabular-nums">{get(d.new_by_month, m)}</td><td className="px-3 py-2.5 tabular-nums">{get(d.ended_by_month, m)}</td><td className="px-3 py-2.5 tabular-nums">{get(d.new_by_month, m) - get(d.ended_by_month, m)}</td></tr>))}
            </DataTable></div>
          )}
        </Card>
      </div>
      <Card title="Definitions" className="mt-4">
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div><dt className="font-medium">Collected</dt><dd className="text-text-2">Succeeded payments minus refunds marked paid out. The only &quot;money received&quot; figure.</dd></div>
          <div><dt className="font-medium">MRR / ARR (estimates)</dt><dd className="text-text-2">Recurring revenue implied by active subscriptions (yearly / 12). Shown on Subscriptions; never mixed with collections.</dd></div>
          <div><dt className="font-medium">Success rate</dt><dd className="text-text-2">Succeeded / (succeeded + failed). Pending payments are excluded; no payments means &quot;No data&quot;, not 0%.</dd></div>
          <div><dt className="font-medium">Not available</dt><dd className="text-text-2">Upgrade/downgrade rates, retention cohorts and trial conversion need data the ledger does not hold (no plan-change history, no trials).</dd></div>
        </dl>
      </Card>
    </>
  );
}
