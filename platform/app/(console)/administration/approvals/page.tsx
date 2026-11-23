import { Flash } from "../../../../components/ui/Flash";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, StatusPill, Unavailable, buttonCls, ghostButtonCls, inputCls, type Tone } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { FAILURE_REASONS } from "../../../../lib/console/errors";
import { can, isRole, ROLE_LABELS, ROLES } from "../../../../lib/console/permissions";
import { formatDateTime } from "../../../../lib/format";
import { cancelRequest, decide, requestChange } from "./actions";

export const metadata = { title: "Approvals" };

type Row = { id: string; ref: string; kind: string; target_email: string; new_role: string | null; reason: string; status: string; requested_by: string; requested_by_email: string | null; decided_by_email: string | null; decision_note: string | null; failure_reason: string | null; created_at: string; decided_at: string | null };
type Res = { viewer_id: string; viewer_can_decide: boolean; counts: Record<string, number>; rows: Row[] };
const KIND: Record<string, string> = { staff_grant: "Grant console access", staff_suspend: "Suspend access", staff_reactivate: "Reactivate access", staff_role_change: "Change role" };
const TONE: Record<string, Tone> = { pending: "attention", approved: "positive", rejected: "neutral", cancelled: "neutral", failed: "danger" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const res = await consoleRpc<Res>(session, "console_approval_list", { p_status: null, p_limit: 100 });
  const canRequest = can(session.access, "request_staff_change");
  if (!res.ok) return (<><PageHeader title="Approvals" /><ErrorState message="Approvals could not be loaded." /></>);
  const { rows, counts, viewer_id, viewer_can_decide } = res.data;
  const pending = rows.filter((r) => r.status === "pending");
  const history = rows.filter((r) => r.status !== "pending").slice(0, 20);

  return (
    <>
      <PageHeader title="Approvals" subtitle="Changes to who can use this console need two people: one requests, a different owner approves, and the change is applied and audited in the same step." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Waiting for a decision" value={counts.pending ?? 0} tone={(counts.pending ?? 0) > 0 ? "attention" : undefined} />
        <KpiCard label="Approved" value={counts.approved ?? 0} />
        <KpiCard label="Rejected" value={counts.rejected ?? 0} />
        <KpiCard label="Failed to apply" value={counts.failed ?? 0} tone={(counts.failed ?? 0) > 0 ? "danger" : undefined} />
      </div>

      <Card title={`Waiting for a decision (${pending.length})`} padded={false} className="mb-4">
        {pending.length === 0 ? <EmptyState message="No requests are waiting." /> : (
          <div className="p-1"><DataTable caption="Pending requests" columns={["Request", "Change", "Person", "Reason", "Requested by", "Decision"]}>
            {pending.map((r) => {
              const mine = r.requested_by === viewer_id;
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.ref}<div className="text-[11px] text-text-3">{formatDateTime(r.created_at)}</div></td>
                  <td className="px-3 py-2.5">{KIND[r.kind]}{r.new_role && isRole(r.new_role) ? <div className="text-xs text-text-3">as {ROLE_LABELS[r.new_role]}</div> : null}</td>
                  <td className="px-3 py-2.5 text-text-2">{r.target_email}</td>
                  <td className="max-w-xs px-3 py-2.5 text-text-2">{r.reason}</td>
                  <td className="px-3 py-2.5 text-xs text-text-3">{mine ? "You" : r.requested_by_email}</td>
                  <td className="px-3 py-2.5">
                    {mine ? (
                      <form action={cancelRequest}><input type="hidden" name="id" value={r.id} /><button className={ghostButtonCls}>Cancel request</button></form>
                    ) : viewer_can_decide ? (
                      <form action={decide} className="flex min-w-[15rem] flex-col gap-2">
                        <input type="hidden" name="id" value={r.id} />
                        <input name="note" maxLength={500} placeholder="Decision note (optional)" className={inputCls} />
                        <div className="flex gap-2">
                          <button name="decision" value="approve" className={buttonCls}>Approve and apply</button>
                          <button name="decision" value="reject" className={ghostButtonCls}>Reject</button>
                        </div>
                      </form>
                    ) : <span className="text-xs text-text-3">Waiting for an owner</span>}
                  </td>
                </tr>
              );
            })}
          </DataTable></div>
        )}
      </Card>

      {canRequest ? (
        <Card title="Request an access change" subtitle="The person must already have an account in the customer app. You cannot request changes to your own access." className="mb-4">
          <form action={requestChange} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <label className="text-sm md:col-span-2"><span className="mb-1 block text-text-2">Change</span>
              <select name="kind" className={`${inputCls} w-full`}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="text-sm md:col-span-2"><span className="mb-1 block text-text-2">Person&apos;s account email</span>
              <input name="email" type="email" required className={`${inputCls} w-full`} /></label>
            <label className="text-sm md:col-span-2"><span className="mb-1 block text-text-2">Role (grant or change only)</span>
              <select name="role" defaultValue="support_agent" className={`${inputCls} w-full`}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
            <label className="text-sm md:col-span-6"><span className="mb-1 block text-text-2">Reason (at least 10 characters; recorded)</span>
              <input name="reason" required minLength={10} maxLength={500} className={`${inputCls} w-full`} /></label>
            <div className="md:col-span-6"><button className={buttonCls}>Submit for approval</button></div>
          </form>
        </Card>
      ) : null}

      {!viewer_can_decide ? (
        <div className="mb-4"><Unavailable title="You can request, but not decide" reason="Only Platform Owners can approve or reject access changes, and never their own request." /></div>
      ) : null}

      <Card title="Recent decisions" subtitle="Last 20. Full history is under Administrative Actions." padded={false}>
        {history.length === 0 ? <EmptyState message="No decisions yet." /> : (
          <div className="p-1"><DataTable caption="Decided requests" columns={["Request", "Change", "Person", "Outcome", "Decided by", "When"]}>
            {history.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.ref}</td>
                <td className="px-3 py-2.5">{KIND[r.kind]}</td>
                <td className="px-3 py-2.5 text-text-2">{r.target_email}</td>
                <td className="px-3 py-2.5"><StatusPill tone={TONE[r.status]}>{r.status}</StatusPill>{r.failure_reason ? <div className="mt-1 text-xs text-text-3">{FAILURE_REASONS[r.failure_reason] ?? r.failure_reason}</div> : null}</td>
                <td className="px-3 py-2.5 text-xs text-text-3">{r.decided_by_email ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{r.decided_at ? formatDateTime(r.decided_at) : "—"}</td>
              </tr>
            ))}
          </DataTable></div>
        )}
      </Card>
    </>
  );
}
