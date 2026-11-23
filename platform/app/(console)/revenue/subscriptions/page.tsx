import Link from "next/link";
import { Flash } from "../../../../components/ui/Flash";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, StatusPill, Tabs, Unavailable, buttonCls, ghostButtonCls, inputCls, type Tone } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { can } from "../../../../lib/console/permissions";
import { formatDate, formatRwf } from "../../../../lib/format";
import { createSubscription, rollPeriods } from "../actions";

export const metadata = { title: "Subscriptions" };

type Overview = {
  has_any_data: boolean; plans: { code: string; name: string; monthly_rwf: number; yearly_rwf: number }[];
  subscriptions_by_status: Record<string, number>; mrr_rwf: number; arr_rwf: number;
};
type Row = { id: string; ref: string; workspace_ref: string; workspace_kind: string; plan_code: string; billing_interval: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean; last_payment_status: string | null };
const TONE: Record<string, Tone> = { pending: "info", active: "positive", past_due: "attention", cancelled: "neutral", expired: "danger" };
const TABS = [{ key: "live", label: "Live" }, { key: "past_due", label: "Past due" }, { key: "cancelled", label: "Cancelled" }, { key: "expired", label: "Expired" }, { key: "all", label: "All" }];

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ s?: string; ok?: string; err?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.s) ? sp.s! : "live";
  const [ov, list] = await Promise.all([
    consoleRpc<Overview>(session, "console_billing_overview", { p_days: 30 }),
    consoleRpc<Row[]>(session, "console_billing_subscriptions", { p_status: tab === "all" ? null : tab, p_limit: 50 }),
  ]);
  const canManage = can(session.access, "manage_subscriptions");
  const c = ov.ok ? ov.data.subscriptions_by_status : {};
  return (
    <>
      <PageHeader title="Subscriptions" subtitle="What each workspace has paid for. Billing never changes what a workspace can use (entitlements); that is a separate decision."
        actions={canManage ? <form action={rollPeriods}><button className={ghostButtonCls} title="Moves lapsed subscriptions to past due or expired. Safe to run repeatedly.">Apply period ends</button></form> : undefined} />
      <Flash ok={sp.ok} err={sp.err} />
      {ov.ok ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiCard label="Active" value={c.active ?? 0} />
          <KpiCard label="Pending first payment" value={c.pending ?? 0} />
          <KpiCard label="Past due" value={c.past_due ?? 0} tone={(c.past_due ?? 0) > 0 ? "attention" : undefined} />
          <KpiCard label="MRR (estimate)" value={ov.data.has_any_data ? formatRwf(ov.data.mrr_rwf) : "No data"} help="Monthly recurring revenue: active monthly prices plus yearly prices / 12. An estimate of recurring revenue, not cash received." />
          <KpiCard label="ARR (estimate)" value={ov.data.has_any_data ? formatRwf(ov.data.arr_rwf) : "No data"} help="MRR x 12. An estimate, not cash received." />
        </div>
      ) : null}

      {ov.ok ? (
        <Card title="Official plans" subtitle="Fixed prices. Yearly is exactly 12 x monthly: there is no annual discount." className="mb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {ov.data.plans.map((p) => (
              <div key={p.code} className="rounded-control border border-border bg-surface-muted p-3">
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="mt-1 text-sm text-text-2">{formatRwf(p.monthly_rwf)} / month</p>
                <p className="text-sm text-text-2">{formatRwf(p.yearly_rwf)} / year</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {canManage ? (
        <Card title="Start a subscription" subtitle="Enter at least 6 characters of the workspace ID (shown as the workspace reference on the customer page)." className="mb-4">
          <form action={createSubscription} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <label className="text-sm md:col-span-2"><span className="mb-1 block text-text-2">Workspace reference</span><input name="workspace_ref" required minLength={6} className={`${inputCls} w-full font-mono`} placeholder="e.g. 585655e8" /></label>
            <label className="text-sm md:col-span-2"><span className="mb-1 block text-text-2">Plan</span>
              <select name="plan" className={`${inputCls} w-full`}><option value="personal">Personal</option><option value="vip">VIP</option><option value="business">Business</option></select></label>
            <label className="text-sm"><span className="mb-1 block text-text-2">Interval</span>
              <select name="interval" className={`${inputCls} w-full`}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
            <div className="flex items-end"><button className={`${buttonCls} w-full`}>Create</button></div>
          </form>
        </Card>
      ) : null}

      <Tabs label="Subscription status" active={tab} items={TABS.map((t) => ({ ...t, href: `/revenue/subscriptions?s=${t.key}` }))} />
      <Card padded={false}>
        {!list.ok ? <div className="p-4"><ErrorState message="Subscriptions could not be loaded." /></div> : list.data.length === 0 ? (
          <EmptyState message="No subscriptions here." hint="No subscription has been recorded yet. Billing is a staff-run ledger: start one above, then record its first payment." />
        ) : (
          <div className="p-1"><DataTable caption="Subscriptions" columns={["Subscription", "Workspace", "Plan", "Status", "Paid until", "Last payment"]}>
            {list.data.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2.5"><Link href={`/revenue/subscriptions/${r.id}`} className="font-mono text-xs font-medium text-accent hover:underline">{r.ref}</Link></td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.workspace_ref} <span className="font-sans text-text-3">({r.workspace_kind})</span></td>
                <td className="px-3 py-2.5 capitalize text-text-2">{r.plan_code} · {r.billing_interval}</td>
                <td className="px-3 py-2.5"><StatusPill tone={TONE[r.status]}>{r.status.replace("_", " ")}</StatusPill>{r.cancel_at_period_end ? <span className="ml-2 text-[11px] text-text-3">ends at period end</span> : null}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{r.current_period_end ? formatDate(r.current_period_end) : "—"}</td>
                <td className="px-3 py-2.5 text-xs text-text-3">{r.last_payment_status ?? "none"}</td>
              </tr>
            ))}
          </DataTable></div>
        )}
      </Card>
      <div className="mt-4"><Unavailable title="Not connected to a payment provider" reason="Payments are recorded by staff from provider receipts. Provider webhooks, customer checkout and automatic entitlement changes are not built (see the billing design)." /></div>
    </>
  );
}
