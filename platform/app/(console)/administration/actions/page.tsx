import Link from "next/link";
import { Card, DataTable, EmptyState, ErrorState, PageHeader, Segmented, StatusPill, type Tone } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { FAILURE_REASONS } from "../../../../lib/console/errors";
import { isRole, ROLE_LABELS } from "../../../../lib/console/permissions";
import { formatDateTime } from "../../../../lib/format";

export const metadata = { title: "Administrative Actions" };

type Row = { id: string; ref: string; kind: string; target_email: string; new_role: string | null; reason: string; status: string; requested_by_email: string | null; decided_by_email: string | null; decision_note: string | null; failure_reason: string | null; created_at: string; decided_at: string | null };
type Res = { rows: Row[] };
const KIND: Record<string, string> = { staff_grant: "Grant console access", staff_suspend: "Suspend access", staff_reactivate: "Reactivate access", staff_role_change: "Change role" };
const TONE: Record<string, Tone> = { pending: "attention", approved: "positive", rejected: "neutral", cancelled: "neutral", failed: "danger" };
const FILTERS = [{ key: "all", label: "All" }, { key: "approved", label: "Applied" }, { key: "rejected", label: "Rejected" }, { key: "failed", label: "Failed" }, { key: "cancelled", label: "Cancelled" }];

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const f = FILTERS.some((x) => x.key === sp.s) ? sp.s! : "all";
  const res = await consoleRpc<Res>(session, "console_approval_list", { p_status: f === "all" ? null : f, p_limit: 200 });
  return (
    <>
      <PageHeader title="Administrative Actions" subtitle="Every privileged change to console access: who asked, who decided, and what happened. The matching audit entries are in Audit Logs."
        actions={<Segmented label="Outcome" active={f} items={FILTERS.map((x) => ({ ...x, href: `/administration/actions${x.key !== "all" ? `?s=${x.key}` : ""}` }))} />} />
      <Card padded={false}>
        {!res.ok ? <div className="p-4"><ErrorState message="Actions could not be loaded." /></div> : res.data.rows.length === 0 ? <EmptyState message="No administrative actions match." /> : (
          <div className="p-1"><DataTable caption="Administrative actions" columns={["Request", "Action", "Person", "Reason", "Requested by", "Decided by", "Outcome", "When"]}>
            {res.data.rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.ref}</td>
                <td className="px-3 py-2.5">{KIND[r.kind]}{r.new_role && isRole(r.new_role) ? <div className="text-xs text-text-3">{ROLE_LABELS[r.new_role]}</div> : null}</td>
                <td className="px-3 py-2.5 text-text-2">{r.target_email}</td>
                <td className="max-w-xs px-3 py-2.5 text-text-2">{r.reason}{r.decision_note ? <div className="mt-1 text-xs text-text-3">Decision: {r.decision_note}</div> : null}</td>
                <td className="px-3 py-2.5 text-xs text-text-3">{r.requested_by_email ?? "—"}</td>
                <td className="px-3 py-2.5 text-xs text-text-3">{r.decided_by_email ?? "—"}</td>
                <td className="px-3 py-2.5"><StatusPill tone={TONE[r.status]}>{r.status === "approved" ? "applied" : r.status}</StatusPill>{r.failure_reason ? <div className="mt-1 text-xs text-text-3">{FAILURE_REASONS[r.failure_reason] ?? r.failure_reason}</div> : null}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{formatDateTime(r.decided_at ?? r.created_at)}</td>
              </tr>
            ))}
          </DataTable></div>
        )}
      </Card>
      <p className="mt-3 text-xs text-text-3">See also <Link href="/security/audit-logs" className="text-accent hover:underline">Audit Logs</Link> for the append-only record.</p>
    </>
  );
}
