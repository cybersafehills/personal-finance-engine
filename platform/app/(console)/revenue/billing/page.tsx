import Link from "next/link";
import { ColumnChart } from "../../../../components/ui/charts";
import { Flash } from "../../../../components/ui/Flash";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, Segmented, StatusPill, Tabs, inputCls, ghostButtonCls, type Tone } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { can } from "../../../../lib/console/permissions";
import { describeDelta, formatDateTime, formatRwf, humanizeAction, ratePercent } from "../../../../lib/format";
import { setReconciliation, settlePayment } from "../actions";

export const metadata = { title: "Billing & Payments" };

type Overview = {
  window_days: number; has_any_data: boolean; collected_rwf: number; collected_prev_rwf: number;
  payments: { initiated: number; succeeded: number; failed: number; pending: number };
  reconciliation: { unreconciled: number; exceptions: number };
  refunds: { pending: number; pending_rwf: number; processed_rwf: number };
  collections_by_day: { day: string; rwf: number }[];
};
type Pay = { id: string; ref: string; subscription_ref: string; subscription_id: string; workspace_ref: string; plan_code: string; amount_rwf: number; provider: string; provider_reference: string; status: string; reconciliation_state: string; reconciliation_note: string | null; initiated_at: string; settled_at: string | null; refunded_rwf: number };
const TONE: Record<string, Tone> = { initiated: "attention", succeeded: "positive", failed: "danger", reversed: "neutral", unreconciled: "attention", matched: "positive", exception: "danger" };
const RANGES = [{ key: "7", label: "7 days" }, { key: "30", label: "30 days" }, { key: "90", label: "90 days" }];
const TABS = [{ key: "all", label: "All" }, { key: "initiated", label: "Pending" }, { key: "succeeded", label: "Succeeded" }, { key: "failed", label: "Failed" }, { key: "unreconciled", label: "Unreconciled" }, { key: "exception", label: "Exceptions" }];

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ days?: string; f?: string; ok?: string; err?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const days = RANGES.some((r) => r.key === sp.days) ? Number(sp.days) : 30;
  const f = TABS.some((t) => t.key === sp.f) ? sp.f! : "all";
  const status = ["initiated", "succeeded", "failed"].includes(f) ? f : null;
  const recon = f === "unreconciled" || f === "exception" ? f : null;
  const [ov, pays] = await Promise.all([
    consoleRpc<Overview>(session, "console_billing_overview", { p_days: days }),
    consoleRpc<Pay[]>(session, "console_billing_payments", { p_status: status, p_recon: recon, p_limit: 50 }),
  ]);
  const canManage = can(session.access, "manage_subscriptions");
  const o = ov.ok ? ov.data : null;
  const settled = o ? o.payments.succeeded + o.payments.failed : 0;
  const rate = o ? ratePercent(o.payments.succeeded, settled) : null;
  const delta = o ? describeDelta(o.collected_rwf, o.collected_prev_rwf) : undefined;
  return (
    <>
      <PageHeader title="Billing & Payments" subtitle="Collected = settled payments minus refunds paid out. Starting a payment is not the same as receiving money."
        actions={<Segmented label="Date range" active={String(days)} items={RANGES.map((r) => ({ ...r, href: `/revenue/billing?days=${r.key}${f !== "all" ? `&f=${f}` : ""}` }))} />} />
      <Flash ok={sp.ok} err={sp.err} />
      {o ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Collected" value={o.has_any_data ? formatRwf(o.collected_rwf) : "No data"} delta={o.has_any_data ? delta : undefined} hint={`last ${days} d`} spark={o.collections_by_day.map((d) => d.rwf)} help="Cash actually received: succeeded payments less refunds marked paid out, in the range. Not an estimate." />
          <KpiCard label="Successful payment rate" value={rate === null ? "No data" : `${rate}%`} hint={`${o.payments.succeeded} succeeded · ${o.payments.failed} failed`} help="Succeeded / (succeeded + failed) for payments started in the range. Payments still pending are excluded." />
          <KpiCard label="Awaiting settlement" value={o.payments.pending} tone={o.payments.pending > 0 ? "attention" : undefined} hint="started, not yet settled" />
          <KpiCard label="Reconciliation" value={`${o.reconciliation.unreconciled} open`} tone={o.reconciliation.exceptions > 0 ? "danger" : undefined} hint={`${o.reconciliation.exceptions} exception${o.reconciliation.exceptions === 1 ? "" : "s"}`} href="/revenue/billing?f=unreconciled" />
        </div>
      ) : <div className="mb-4"><ErrorState message="Billing figures could not be loaded." /></div>}

      {o ? (
        <Card title="Collections per day" subtitle={`Last ${days} days (Kigali time). Succeeded payments only.`} className="mb-4">
          {o.has_any_data ? <ColumnChart points={o.collections_by_day.map((d) => ({ label: d.day, value: d.rwf }))} unit=" RWF" summary={`Collections per day over ${days} days, ${formatRwf(o.collected_rwf)} net.`} />
            : <EmptyState message="No payments recorded yet." hint="Nothing is plotted instead of a flat zero line." />}
        </Card>
      ) : null}

      <Tabs label="Payment filter" active={f} items={TABS.map((t) => ({ ...t, href: `/revenue/billing?days=${days}${t.key !== "all" ? `&f=${t.key}` : ""}` }))} />
      <Card padded={false}>
        {!pays.ok ? <div className="p-4"><ErrorState message="Payments could not be loaded." /></div> : pays.data.length === 0 ? <EmptyState message="No payments match." /> : (
          <div className="p-1"><DataTable caption="Payments" columns={["Payment", "Subscription", "Amount", "Provider reference", "Status", "Reconciliation", "When", ""]}>
            {pays.data.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="px-3 py-2.5 font-mono text-xs">{p.ref}</td>
                <td className="px-3 py-2.5"><Link href={`/revenue/subscriptions/${p.subscription_id}`} className="font-mono text-xs text-accent hover:underline">{p.subscription_ref}</Link><div className="text-[11px] text-text-3">{p.workspace_ref} · {p.plan_code}</div></td>
                <td className="px-3 py-2.5">{formatRwf(p.amount_rwf)}{p.refunded_rwf > 0 ? <div className="text-[11px] text-text-3">refunded {formatRwf(p.refunded_rwf)}</div> : null}</td>
                <td className="px-3 py-2.5 text-xs text-text-2">{humanizeAction(p.provider)}<div className="font-mono">{p.provider_reference}</div></td>
                <td className="px-3 py-2.5"><StatusPill tone={TONE[p.status]}>{p.status}</StatusPill></td>
                <td className="px-3 py-2.5"><StatusPill tone={TONE[p.reconciliation_state]}>{p.reconciliation_state}</StatusPill>{p.reconciliation_note ? <div className="mt-1 text-[11px] text-text-3">{p.reconciliation_note}</div> : null}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{formatDateTime(p.settled_at ?? p.initiated_at)}</td>
                <td className="px-3 py-2.5">
                  {canManage ? (p.status === "initiated" ? (
                    <form action={settlePayment} className="flex gap-1"><input type="hidden" name="id" value={p.id} /><button name="outcome" value="succeeded" className={ghostButtonCls}>Settled</button><button name="outcome" value="failed" className={ghostButtonCls}>Failed</button></form>
                  ) : p.status === "succeeded" ? (
                    <form action={setReconciliation} className="flex min-w-[13rem] flex-col gap-1">
                      <input type="hidden" name="id" value={p.id} />
                      <input name="note" maxLength={500} placeholder="Note (required for exception)" className={`${inputCls} h-8 text-xs`} aria-label="Reconciliation note" />
                      <div className="flex gap-1"><button name="state" value="matched" className={ghostButtonCls}>Matched</button><button name="state" value="exception" className={ghostButtonCls}>Exception</button></div>
                      <Link href={`/revenue/refunds?pay=${p.id}`} className="text-[11px] text-accent hover:underline">Request a refund</Link>
                    </form>
                  ) : null) : null}
                </td>
              </tr>
            ))}
          </DataTable></div>
        )}
      </Card>
    </>
  );
}
