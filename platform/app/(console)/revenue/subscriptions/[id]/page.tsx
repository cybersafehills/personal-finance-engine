import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "../../../../../components/ui/Icon";
import { Flash } from "../../../../../components/ui/Flash";
import { Card, DataTable, EmptyState, ErrorState, PageHeader, StatusPill, buttonCls, ghostButtonCls, inputCls, type Tone } from "../../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../../lib/console/access";
import { can } from "../../../../../lib/console/permissions";
import { formatDate, formatDateTime, formatRwf, humanizeAction } from "../../../../../lib/format";
import { cancelSubscription, recordPayment, settlePayment } from "../../actions";

export const metadata = { title: "Subscription" };

type Sub = {
  id: string; ref: string; workspace_ref: string; workspace_kind: string; plan_name: string; billing_interval: string; price_rwf: number; status: string;
  current_period_start: string | null; current_period_end: string | null; cancel_at_period_end: boolean; cancelled_at: string | null; cancel_reason: string | null;
  payments: { id: string; ref: string; amount_rwf: number; provider: string; provider_reference: string; status: string; reconciliation_state: string; initiated_at: string; settled_at: string | null }[];
  events: { kind: string; from_status: string | null; to_status: string | null; actor_role: string | null; created_at: string }[];
};
const TONE: Record<string, Tone> = { pending: "info", active: "positive", past_due: "attention", cancelled: "neutral", expired: "danger", initiated: "attention", succeeded: "positive", failed: "danger", reversed: "neutral" };

export default async function SubscriptionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const session = await requireSession();
  const r = await consoleRpc<Sub>(session, "console_billing_subscription_get", { p_id: id });
  if (!r.ok) return (<><PageHeader title="Subscription" /><ErrorState message="This subscription could not be loaded." /></>);
  const s = r.data;
  const canManage = can(session.access, "manage_subscriptions");
  const open = s.status === "pending" || s.status === "active" || s.status === "past_due";
  return (
    <>
      <Link href="/revenue/subscriptions" className="mb-3 inline-flex items-center gap-1 text-sm text-text-3 hover:text-text"><Icon name="prev" size={14} /> All subscriptions</Link>
      <PageHeader title={`${s.ref} · ${s.plan_name} (${s.billing_interval})`} subtitle={`Workspace ${s.workspace_ref} (${s.workspace_kind}) · ${formatRwf(s.price_rwf)} per ${s.billing_interval === "monthly" ? "month" : "year"}`}
        actions={<StatusPill tone={TONE[s.status]}>{s.status.replace("_", " ")}</StatusPill>} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Card title="Payments" padded={false}>
            {s.payments.length === 0 ? <EmptyState message="No payments recorded." hint="The subscription activates when the first payment is recorded as succeeded." /> : (
              <div className="p-1"><DataTable caption="Payments" columns={["Payment", "Amount", "Provider reference", "Status", "Reconciliation", "When", ""]}>
                {s.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2.5 font-mono text-xs">{p.ref}</td>
                    <td className="px-3 py-2.5">{formatRwf(p.amount_rwf)}</td>
                    <td className="px-3 py-2.5 text-xs text-text-2">{humanizeAction(p.provider)} · <span className="font-mono">{p.provider_reference}</span></td>
                    <td className="px-3 py-2.5"><StatusPill tone={TONE[p.status]}>{p.status}</StatusPill></td>
                    <td className="px-3 py-2.5 text-xs text-text-2">{p.reconciliation_state}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{formatDateTime(p.settled_at ?? p.initiated_at)}</td>
                    <td className="px-3 py-2.5">
                      {canManage && p.status === "initiated" ? (
                        <form action={settlePayment} className="flex gap-1">
                          <input type="hidden" name="id" value={p.id} /><input type="hidden" name="return" value={`/revenue/subscriptions/${s.id}`} />
                          <button name="outcome" value="succeeded" className={ghostButtonCls}>Settled</button>
                          <button name="outcome" value="failed" className={ghostButtonCls}>Failed</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </DataTable></div>
            )}
          </Card>
          <Card title="History" subtitle="Append-only.">
            <ol className="space-y-2 text-sm">
              {s.events.map((e, i) => (
                <li key={i} className="flex justify-between gap-3"><span>{humanizeAction(e.kind)}{e.from_status && e.to_status && e.from_status !== e.to_status ? `: ${e.from_status} → ${e.to_status}` : ""}</span><span className="text-xs text-text-3">{e.actor_role ? `${humanizeAction(e.actor_role)} · ` : ""}{formatDateTime(e.created_at)}</span></li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Period"><dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-text-3">Started</dt><dd>{s.current_period_start ? formatDate(s.current_period_start) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-text-3">Paid until</dt><dd>{s.current_period_end ? formatDate(s.current_period_end) : "—"}</dd></div>
            {s.cancel_at_period_end ? <p className="rounded-control bg-attention-soft px-2 py-1 text-xs text-attention-ink">Set to cancel at the end of this period.</p> : null}
            {s.cancelled_at ? <div className="flex justify-between"><dt className="text-text-3">Cancelled</dt><dd>{formatDate(s.cancelled_at)}</dd></div> : null}
            {s.cancel_reason ? <p className="text-xs text-text-3">Reason: {s.cancel_reason}</p> : null}
          </dl></Card>
          {canManage && open ? (
            <>
              <Card title="Record a payment" subtitle={`Amount is fixed at ${formatRwf(s.price_rwf)}; it cannot be changed here.`}>
                <form action={recordPayment} className="space-y-2">
                  <input type="hidden" name="id" value={s.id} />
                  <select name="provider" className={`${inputCls} w-full`} aria-label="Provider"><option value="mtn_momo">MTN Mobile Money</option><option value="airtel_money">Airtel Money</option><option value="bank">Bank</option><option value="card">Card</option><option value="manual">Manual / cash</option></select>
                  <input name="reference" required minLength={3} maxLength={100} className={`${inputCls} w-full font-mono`} placeholder="Provider reference (must be unique)" aria-label="Provider reference" />
                  <select name="outcome" className={`${inputCls} w-full`} aria-label="Outcome"><option value="succeeded">Succeeded (money received)</option><option value="initiated">Initiated (not settled yet)</option><option value="failed">Failed</option></select>
                  <button className={`${buttonCls} w-full`}>Record payment</button>
                  <p className="text-xs text-text-3">Recording the same reference twice changes nothing.</p>
                </form>
              </Card>
              <Card title="Cancel">
                <form action={cancelSubscription} className="space-y-2">
                  <input type="hidden" name="id" value={s.id} />
                  <select name="when" className={`${inputCls} w-full`} aria-label="When"><option value="end">At the end of the paid period</option><option value="now">Immediately</option></select>
                  <input name="reason" required minLength={10} maxLength={500} className={`${inputCls} w-full`} placeholder="Reason (at least 10 characters)" aria-label="Reason" />
                  <button className={`${ghostButtonCls} w-full`}>Cancel subscription</button>
                </form>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
