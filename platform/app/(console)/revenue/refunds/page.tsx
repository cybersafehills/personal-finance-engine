import { Flash } from "../../../../components/ui/Flash";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, StatusPill, Unavailable, buttonCls, ghostButtonCls, inputCls, type Tone } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { formatDateTime, formatRwf } from "../../../../lib/format";
import { decideRefund, processRefund, requestRefund } from "../actions";

export const metadata = { title: "Refunds & Reconciliation" };

type Row = { id: string; ref: string; payment_ref: string; payment_rwf: number; amount_rwf: number; reason: string; status: string; requested_by: string; requested_by_email: string | null; decided_by_email: string | null; decision_note: string | null; payout_reference: string | null; created_at: string; decided_at: string | null; processed_at: string | null };
type Res = { viewer_id: string; viewer_can_decide: boolean; viewer_can_request: boolean; rows: Row[] };
const TONE: Record<string, Tone> = { requested: "attention", approved: "info", rejected: "neutral", processed: "positive" };

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ pay?: string; ok?: string; err?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const res = await consoleRpc<Res>(session, "console_billing_refunds", { p_status: null, p_limit: 100 });
  if (!res.ok) return (<><PageHeader title="Refunds & Reconciliation" /><ErrorState message="Refunds could not be loaded." /></>);
  const { rows, viewer_id, viewer_can_decide, viewer_can_request } = res.data;
  const open = rows.filter((r) => r.status === "requested" || r.status === "approved");
  const payId = sp.pay && /^[0-9a-f-]{36}$/i.test(sp.pay) ? sp.pay : "";
  return (
    <>
      <PageHeader title="Refunds & Reconciliation" subtitle="A refund needs a request, a different Finance Administrator to approve it, and a payout reference once it is paid. The console records refunds; it never pays anyone. Reconciliation is set per payment under Billing & Payments." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Waiting for a decision" value={rows.filter((r) => r.status === "requested").length} tone={rows.some((r) => r.status === "requested") ? "attention" : undefined} />
        <KpiCard label="Approved, not yet paid out" value={rows.filter((r) => r.status === "approved").length} />
        <KpiCard label="Paid out" value={formatRwf(rows.filter((r) => r.status === "processed").reduce((a, r) => a + r.amount_rwf, 0))} />
        <KpiCard label="Rejected" value={rows.filter((r) => r.status === "rejected").length} />
      </div>

      {viewer_can_request ? (
        <Card title="Request a refund" subtitle="Open the payment from Billing & Payments to prefill it. The amount cannot exceed what is left on the payment." className="mb-4">
          <form action={requestRefund} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <label className="text-sm md:col-span-2"><span className="mb-1 block text-text-2">Payment ID</span><input name="payment_id" required defaultValue={payId} pattern="[0-9a-fA-F-]{36}" className={`${inputCls} w-full font-mono text-xs`} /></label>
            <label className="text-sm"><span className="mb-1 block text-text-2">Amount (RWF)</span><input name="amount" type="number" min={1} step={1} required className={`${inputCls} w-full`} /></label>
            <label className="text-sm md:col-span-3"><span className="mb-1 block text-text-2">Reason (at least 10 characters)</span><input name="reason" required minLength={10} maxLength={500} className={`${inputCls} w-full`} /></label>
            <div className="md:col-span-6"><button className={buttonCls}>Request refund</button></div>
          </form>
        </Card>
      ) : null}
      {!viewer_can_decide ? <div className="mb-4"><Unavailable title="You can see refunds, not decide them" reason="Only a Finance Administrator can approve, reject or mark a refund as paid out, and never one they requested. The Platform Owner deliberately cannot." /></div> : null}

      <Card title={`Open refunds (${open.length})`} padded={false} className="mb-4">
        {open.length === 0 ? <EmptyState message="No refunds are waiting." /> : (
          <div className="p-1"><DataTable caption="Open refunds" columns={["Refund", "Payment", "Amount", "Reason", "Requested by", "Status", "Action"]}>
            {open.map((r) => {
              const mine = r.requested_by === viewer_id;
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2.5 font-mono text-xs">{r.ref}<div className="text-[11px] text-text-3">{formatDateTime(r.created_at)}</div></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.payment_ref}<div className="font-sans text-[11px] text-text-3">of {formatRwf(r.payment_rwf)}</div></td>
                  <td className="px-3 py-2.5 font-medium">{formatRwf(r.amount_rwf)}</td>
                  <td className="max-w-xs px-3 py-2.5 text-text-2">{r.reason}</td>
                  <td className="px-3 py-2.5 text-xs text-text-3">{mine ? "You" : r.requested_by_email}</td>
                  <td className="px-3 py-2.5"><StatusPill tone={TONE[r.status]}>{r.status}</StatusPill></td>
                  <td className="px-3 py-2.5">
                    {!viewer_can_decide ? <span className="text-xs text-text-3">Waiting for Finance</span>
                      : r.status === "requested" ? (mine ? <span className="text-xs text-text-3">You requested this; another Finance Administrator must decide.</span> : (
                        <form action={decideRefund} className="flex min-w-[14rem] flex-col gap-2"><input type="hidden" name="id" value={r.id} /><input name="note" maxLength={500} placeholder="Decision note (optional)" className={inputCls} />
                          <div className="flex gap-2"><button name="decision" value="approve" className={buttonCls}>Approve</button><button name="decision" value="reject" className={ghostButtonCls}>Reject</button></div></form>))
                      : (
                        <form action={processRefund} className="flex min-w-[14rem] flex-col gap-2"><input type="hidden" name="id" value={r.id} />
                          <input name="payout_reference" required minLength={3} maxLength={100} placeholder="Payout reference (e.g. MoMo ID)" className={`${inputCls} font-mono`} />
                          <button className={buttonCls}>Mark as paid out</button></form>)}
                  </td>
                </tr>
              );
            })}
          </DataTable></div>
        )}
      </Card>

      <Card title="Completed" subtitle="Paid out and rejected refunds" padded={false}>
        {rows.filter((r) => r.status === "processed" || r.status === "rejected").length === 0 ? <EmptyState message="Nothing completed yet." /> : (
          <div className="p-1"><DataTable caption="Completed refunds" columns={["Refund", "Payment", "Amount", "Outcome", "Decided by", "Payout reference", "When"]}>
            {rows.filter((r) => r.status === "processed" || r.status === "rejected").map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2.5 font-mono text-xs">{r.ref}</td><td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.payment_ref}</td>
                <td className="px-3 py-2.5">{formatRwf(r.amount_rwf)}</td>
                <td className="px-3 py-2.5"><StatusPill tone={TONE[r.status]}>{r.status === "processed" ? "paid out" : r.status}</StatusPill></td>
                <td className="px-3 py-2.5 text-xs text-text-3">{r.decided_by_email ?? "—"}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.payout_reference ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{formatDateTime(r.processed_at ?? r.decided_at ?? r.created_at)}</td>
              </tr>
            ))}
          </DataTable></div>
        )}
      </Card>
    </>
  );
}
