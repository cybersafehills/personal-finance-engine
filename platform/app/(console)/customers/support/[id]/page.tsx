import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "../../../../../components/ui/Icon";
import { Flash } from "../../../../../components/ui/Flash";
import { Card, ErrorState, PageHeader, StatusPill, buttonCls, ghostButtonCls, inputCls } from "../../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../../lib/console/access";
import { formatDateTime, humanizeAction } from "../../../../../lib/format";
import { addNote, assignTicket, setStatus } from "../actions";

export const metadata = { title: "Ticket" };

type Ev = { id: string; kind: string; actor_role: string | null; actor_email: string | null; body: string | null; from_status: string | null; to_status: string | null; assignee_email: string | null; created_at: string };
type Ticket = { id: string; ref: string; subject: string; category: string; priority: string; status: string; customer_id: string | null; customer_ref: string | null; assigned_to: string | null; assignee_email: string | null; created_at: string; updated_at: string; events: Ev[] };
type Assignee = { user_id: string; email: string; role: string };

const NEXT: Record<string, string[]> = {
  open: ["in_progress", "waiting", "escalated", "resolved", "closed"],
  in_progress: ["waiting", "escalated", "resolved", "closed", "open"],
  waiting: ["in_progress", "escalated", "resolved", "closed", "open"],
  escalated: ["in_progress", "resolved", "closed"],
  resolved: ["closed", "open"],
  closed: ["open"],
};
const TONE: Record<string, "info" | "neutral" | "danger" | "positive"> = { open: "info", in_progress: "info", waiting: "neutral", escalated: "danger", resolved: "positive", closed: "neutral" };

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const session = await requireSession();
  const [t, a] = await Promise.all([
    consoleRpc<Ticket>(session, "console_support_get", { p_id: id }),
    consoleRpc<Assignee[]>(session, "console_support_assignees"),
  ]);
  if (!t.ok) return (<><PageHeader title="Ticket" /><ErrorState message="This ticket could not be loaded." /></>);
  const k = t.data;
  const assignees = a.ok ? a.data : [];
  return (
    <>
      <Link href="/customers/support" className="mb-3 inline-flex items-center gap-1 text-sm text-text-3 hover:text-text"><Icon name="prev" size={14} /> All tickets</Link>
      <PageHeader title={k.subject} subtitle={`${k.ref} · ${humanizeAction(k.category)} · logged by staff${k.customer_ref ? ` · customer ${k.customer_ref}` : ""}`}
        actions={<StatusPill tone={TONE[k.status]}>{k.status.replace("_", " ")}</StatusPill>} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-4">
          <Card title="Timeline" subtitle="Newest at the bottom. Entries cannot be edited or removed.">
            <ol className="space-y-4">
              {k.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">
                        {e.kind === "created" ? "Ticket logged" : e.kind === "note" ? "Note" : e.kind === "assignment" ? `Assigned to ${e.assignee_email ?? "nobody"}` : `Status: ${e.from_status?.replace("_", " ")} → ${e.to_status?.replace("_", " ")}`}
                      </span>
                      <span className="ml-2 text-xs text-text-3">{e.actor_email ?? e.actor_role} · {formatDateTime(e.created_at)}</span>
                    </p>
                    {e.body ? <p className="mt-1 whitespace-pre-wrap rounded-control bg-surface-muted px-3 py-2 text-sm text-text-2">{e.body}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Add an internal note" subtitle="Visible to support staff only. Do not paste passwords, PINs or full account numbers.">
            <form action={addNote} className="space-y-2">
              <input type="hidden" name="id" value={k.id} />
              <textarea name="body" required maxLength={2000} rows={3} className={`${inputCls} h-auto w-full py-2`} aria-label="Note" />
              <button className={buttonCls}>Add note</button>
            </form>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Change status">
            <form action={setStatus} className="space-y-2">
              <input type="hidden" name="id" value={k.id} />
              <select name="status" className={`${inputCls} w-full`} aria-label="New status">{(NEXT[k.status] ?? []).map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
              <input name="note" maxLength={500} placeholder="Note (required to escalate or resolve)" className={`${inputCls} w-full`} />
              <button className={`${buttonCls} w-full`}>Update status</button>
            </form>
          </Card>
          <Card title="Assignment" subtitle={k.assignee_email ? `Currently ${k.assignee_email}` : "Unassigned"}>
            <form action={assignTicket} className="space-y-2">
              <input type="hidden" name="id" value={k.id} />
              <select name="assignee" defaultValue={k.assigned_to ?? ""} className={`${inputCls} w-full`} aria-label="Assignee">
                <option value="">Unassigned</option>
                {assignees.map((p) => <option key={p.user_id} value={p.user_id}>{p.email}</option>)}
              </select>
              <button className={`${ghostButtonCls} w-full`}>Save assignment</button>
            </form>
          </Card>
          {k.customer_id ? <Link href={`/customers/users/${k.customer_id}`} className={`${ghostButtonCls} w-full`}>Open customer</Link> : null}
        </div>
      </div>
    </>
  );
}
