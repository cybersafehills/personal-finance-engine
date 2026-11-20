import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "../../../../../components/ui/Icon";
import { Flash } from "../../../../../components/ui/Flash";
import { Card, ErrorState, PageHeader, StatusPill, buttonCls, ghostButtonCls, inputCls, type Tone } from "../../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../../lib/console/access";
import { formatDateTime, humanizeAction } from "../../../../../lib/format";
import { addUpdate, setIncidentStatus } from "../actions";

export const metadata = { title: "Incident" };

type Ev = { id: string; kind: string; actor_role: string | null; actor_email: string | null; body: string | null; from_status: string | null; to_status: string | null; created_at: string };
type Inc = { id: string; ref: string; title: string; severity: string; category: string; detection_source: string; status: string; owner_email: string | null; started_at: string; resolved_at: string | null; events: Ev[] };
const NEXT: Record<string, string[]> = { open: ["investigating", "contained", "resolved"], investigating: ["contained", "resolved", "open"], contained: ["investigating", "resolved"], resolved: ["investigating"] };
const ST_TONE: Record<string, Tone> = { open: "danger", investigating: "attention", contained: "info", resolved: "positive" };
const LABEL: Record<string, string> = { declared: "Declared", update: "Update", containment: "Containment action", status_change: "Status change", owner_change: "Owner change", resolution: "Resolved" };

export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const session = await requireSession();
  const r = await consoleRpc<Inc>(session, "console_incident_get", { p_id: id });
  if (!r.ok) return (<><PageHeader title="Incident" /><ErrorState message="This incident could not be loaded." /></>);
  const i = r.data;
  return (
    <>
      <Link href="/security/incidents" className="mb-3 inline-flex items-center gap-1 text-sm text-text-3 hover:text-text"><Icon name="prev" size={14} /> All incidents</Link>
      <PageHeader title={i.title} subtitle={`${i.ref} · ${i.severity.toUpperCase()} · ${humanizeAction(i.category)} · detected by ${humanizeAction(i.detection_source).toLowerCase()} · started ${formatDateTime(i.started_at)}`}
        actions={<StatusPill tone={ST_TONE[i.status]}>{i.status}</StatusPill>} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-4">
          <Card title="Timeline" subtitle="Append-only. Entries cannot be edited or removed.">
            <ol className="space-y-4">
              {i.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm"><span className="font-medium">{LABEL[e.kind] ?? e.kind}{e.from_status ? `: ${e.from_status} → ${e.to_status}` : ""}</span>
                      <span className="ml-2 text-xs text-text-3">{e.actor_email ?? e.actor_role} · {formatDateTime(e.created_at)}</span></p>
                    {e.body ? <p className="mt-1 whitespace-pre-wrap rounded-control bg-surface-muted px-3 py-2 text-sm text-text-2">{e.body}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Add to the timeline" subtitle="Record facts and actions. Do not paste credentials or customer financial data.">
            <form action={addUpdate} className="space-y-2">
              <input type="hidden" name="id" value={i.id} />
              <select name="kind" className={`${inputCls} w-full sm:w-64`} aria-label="Entry type"><option value="update">Investigation update</option><option value="containment">Containment action</option></select>
              <textarea name="body" required maxLength={2000} rows={3} className={`${inputCls} h-auto w-full py-2`} aria-label="Entry" />
              <button className={buttonCls}>Add entry</button>
            </form>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Change status" subtitle={i.owner_email ? `Owner: ${i.owner_email}` : undefined}>
            <form action={setIncidentStatus} className="space-y-2">
              <input type="hidden" name="id" value={i.id} />
              <select name="status" className={`${inputCls} w-full`} aria-label="New status">{(NEXT[i.status] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}</select>
              <input name="note" maxLength={500} placeholder="Note (required to resolve)" className={`${inputCls} w-full`} />
              <button className={`${ghostButtonCls} w-full`}>Update status</button>
            </form>
          </Card>
          <Link href="/platform/health" className={`${ghostButtonCls} w-full`}>Check System Health</Link>
        </div>
      </div>
    </>
  );
}
