import Link from "next/link";
import { Card, ErrorState, KpiCard, PageHeader, StatusPill, DataTable, EmptyState } from "../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../lib/console/access";
import { isRole, ROLE_LABELS } from "../../../lib/console/permissions";
import { formatCount, formatDateTime, humanizeAction } from "../../../lib/format";

export const metadata = { title: "Security Center" };

type Overview = {
  staff: { active: number; suspended: number; with_verified_mfa: number; by_role: { role: string; count: number }[] };
  audit_7d: { total: number; denied: number; failed: number; top_actions: { action: string; count: number }[] };
  customer_logins_24h: { succeeded: number; failed: number };
  recent_denials: { created_at: string; actor_role: string | null; action: string; target_id: string | null }[];
};

export default async function SecurityPage() {
  const session = await requireSession();
  const res = await consoleRpc<Overview>(session, "console_security_overview");
  if (!res.ok) return (<><PageHeader title="Security Center" /><ErrorState message="The security overview could not be loaded." /></>);
  const o = res.data;
  const mfaGap = o.staff.active - o.staff.with_verified_mfa;
  return (
    <>
      <PageHeader title="Security Center" subtitle="Posture of the console and recent privileged activity. Counts only; an alert here is a signal to investigate, not proof of misuse." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active staff" value={o.staff.active} hint={o.staff.suspended ? `${o.staff.suspended} suspended` : "None suspended"} href="/security/access" />
        <KpiCard label="Staff with MFA" value={`${o.staff.with_verified_mfa}/${o.staff.active}`}
          tone={mfaGap > 0 ? "attention" : undefined}
          hint={mfaGap > 0 ? `${mfaGap} active staff without a verified authenticator` : "Every active staff member is enrolled"}
          help="Console access is blocked below MFA, so a gap means that person has not yet completed first sign-in." />
        <KpiCard label="Denied actions (7 d)" value={formatCount(o.audit_7d.denied)} tone={o.audit_7d.denied > 0 ? "attention" : undefined}
          hint={`${formatCount(o.audit_7d.total)} audited events`} href="/security/audit-logs" />
        <KpiCard label="Customer sign-ins (24 h)" value={formatCount(o.customer_logins_24h.succeeded)}
          hint={`${formatCount(o.customer_logins_24h.failed)} failed`}
          help="From the customer app's login ledger. A spike in failures can indicate credential stuffing, but is not proof." />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Staff by role" subtitle="Active staff only">
          {o.staff.by_role.length === 0 ? <EmptyState message="No staff." /> : (
            <ul className="divide-y divide-border">
              {o.staff.by_role.map((r) => (
                <li key={r.role} className="flex items-center justify-between py-2 text-sm">
                  <span>{isRole(r.role) ? ROLE_LABELS[r.role] : r.role}</span><span className="tabular-nums text-text-2">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Most frequent actions" subtitle="Console audit trail, last 7 days">
          {o.audit_7d.top_actions.length === 0 ? <EmptyState message="No audited activity yet." /> : (
            <ul className="divide-y divide-border">
              {o.audit_7d.top_actions.map((a) => (
                <li key={a.action} className="flex items-center justify-between py-2 text-sm">
                  <span>{humanizeAction(a.action)}</span><span className="tabular-nums text-text-2">{a.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Recent denials" subtitle="Attempts blocked by the permission check" className="mt-4" padded={false}
        action={<Link href="/security/audit-logs" className="text-xs font-medium text-accent hover:underline">Full audit log</Link>}>
        {o.recent_denials.length === 0 ? <EmptyState message="No denied actions." hint="A denial is recorded when a signed-in staff member tries something their role does not allow." /> : (
          <DataTable caption="Recent permission denials" columns={["Time", "Role", "Action", "Target"]}>
            {o.recent_denials.map((d, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{formatDateTime(d.created_at)}</td>
                <td className="px-3 py-2.5 text-text-2">{d.actor_role && isRole(d.actor_role) ? ROLE_LABELS[d.actor_role] : "—"}</td>
                <td className="px-3 py-2.5"><StatusPill tone="danger">{humanizeAction(d.action)}</StatusPill></td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-3">{d.target_id ?? "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
