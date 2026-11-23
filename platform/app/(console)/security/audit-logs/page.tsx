import Link from "next/link";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusPill,
  type Tone,
} from "../../../../components/ui/primitives";
import { auditView, consoleRpc, requireSession } from "../../../../lib/console/access";
import { can, isRole, ROLE_LABELS } from "../../../../lib/console/permissions";
import { formatDateTime } from "../../../../lib/format";

export const metadata = { title: "Audit Logs" };

type Row = {
  id: string;
  created_at: string;
  actor_role: string | null;
  actor_ref: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: "success" | "denied" | "failed";
  reason: string | null;
  correlation_id: string;
};
const TONE: Record<Row["outcome"], Tone> = { success: "positive", denied: "danger", failed: "attention" };
const PAGE = 50;

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.access, "view_audit_logs")) {
    return (
      <>
        <PageHeader title="Audit Logs" />
        <ErrorState message="Your role does not include access to audit logs." />
      </>
    );
  }
  const { before } = await searchParams;
  const parsed = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null;

  // Reading the audit trail is itself an audited action (first page only, so
  // paging does not flood the log).
  if (!parsed) await auditView(session, "audit_log.viewed", "audit-logs");

  const res = await consoleRpc<Row[]>(session, "console_audit_log", {
    p_limit: PAGE,
    p_before: parsed,
  });

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Append-only record of console activity. Entries cannot be edited or deleted."
      />
      <Card>
        {!res.ok ? (
          <ErrorState message="Audit log could not be loaded." />
        ) : res.data.length === 0 ? (
          <EmptyState message="No audit events recorded yet." />
        ) : (
          <>
            <DataTable
              caption="Console audit events, newest first"
              columns={["Time", "Actor", "Action", "Target", "Outcome", "Reason", "Correlation"]}
            >
              {res.data.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-2 py-2 text-text-2">{formatDateTime(r.created_at)}</td>
                  <td className="px-2 py-2 text-xs">
                    {r.actor_role && isRole(r.actor_role) ? ROLE_LABELS[r.actor_role] : "—"}
                    {r.actor_ref ? <span className="ml-1 font-mono text-text-3">{r.actor_ref}</span> : null}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-2 py-2 text-xs text-text-2">
                    {[r.target_type, r.target_id].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-2 py-2"><StatusPill tone={TONE[r.outcome]}>{r.outcome}</StatusPill></td>
                  <td className="px-2 py-2 text-xs text-text-2">{r.reason ?? "—"}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-text-3">{r.correlation_id.slice(0, 8)}</td>
                </tr>
              ))}
            </DataTable>
            {res.data.length === PAGE ? (
              <div className="mt-3 text-right">
                <Link
                  href={`/security/audit-logs?before=${encodeURIComponent(res.data[res.data.length - 1].created_at)}`}
                  className="text-sm text-accent underline"
                >
                  Older events →
                </Link>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
