import { DataTable, EmptyState, ErrorState, Card, PageHeader, Pager, Segmented, StatusPill, type Tone } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { can, isRole, ROLE_LABELS } from "../../../../lib/console/permissions";
import { formatDateTime, humanizeAction } from "../../../../lib/format";

export const metadata = { title: "Activity Center" };

type Row = { occurred_at: string; event_type: "registration" | "admin_action"; event: string; category: string; subject: string; status: string; operator_role: string | null };
const PAGE = 50;
const TONE: Record<string, Tone> = { completed: "positive", success: "positive", restricted: "attention", denied: "danger", failed: "danger" };
const TYPES = [{ key: "all", label: "All" }, { key: "registration", label: "Registrations" }, { key: "admin_action", label: "Admin actions" }];

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ type?: string; before?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const type = sp.type === "registration" || sp.type === "admin_action" ? sp.type : "all";
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before).toISOString() : null;
  const canAudit = can(session.access, "view_audit_logs");
  const res = await consoleRpc<Row[]>(session, "console_activity_page", { p_limit: PAGE, p_before: before, p_type: type === "all" ? null : type });
  const base = (t: string) => `/overview/activity${t !== "all" ? `?type=${t}` : ""}`;
  const last = res.ok && res.data.length === PAGE ? res.data[res.data.length - 1].occurred_at : null;
  const next = last ? `/overview/activity?${new URLSearchParams({ ...(type !== "all" ? { type } : {}), before: last })}` : null;

  return (
    <>
      <PageHeader title="Activity Center" subtitle={`Every registration${canAudit ? " and administrative action" : ""}, newest first.`}
        actions={canAudit ? <Segmented label="Event type" active={type} items={TYPES.map((t) => ({ ...t, href: base(t.key) }))} /> : undefined} />
      <Card padded={false}>
        {!res.ok ? <div className="p-4"><ErrorState message="Activity could not be loaded." /></div>
          : res.data.length === 0 ? <EmptyState message="No activity matches." />
          : (
            <div className="p-1">
              <DataTable caption="Platform activity" columns={["Time", "Event", "Subject", "Category", "Status", "Operator"]}>
                {res.data.map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{formatDateTime(r.occurred_at)}</td>
                    <td className="px-3 py-2.5">{r.event_type === "admin_action" ? humanizeAction(r.event) : r.event}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.subject}</td>
                    <td className="px-3 py-2.5 text-text-2">{r.category}</td>
                    <td className="px-3 py-2.5"><StatusPill tone={TONE[r.status] ?? "neutral"}>{r.status}</StatusPill></td>
                    <td className="px-3 py-2.5 text-xs text-text-3">{r.operator_role && isRole(r.operator_role) ? ROLE_LABELS[r.operator_role] : "—"}</td>
                  </tr>
                ))}
              </DataTable>
              <div className="px-3 pb-3"><Pager nextHref={next} prevHref={before ? base(type) : null} summary={`${res.data.length} events shown`} /></div>
            </div>
          )}
      </Card>
    </>
  );
}
