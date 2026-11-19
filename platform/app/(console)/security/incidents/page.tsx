import Link from "next/link";
import { Flash } from "../../../../components/ui/Flash";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, StatusPill, Tabs, buttonCls, inputCls, type Tone } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { humanizeAction, timeAgo } from "../../../../lib/format";
import { declareIncident } from "./actions";

export const metadata = { title: "Incidents" };

type Row = { id: string; ref: string; title: string; severity: string; category: string; detection_source: string; status: string; started_at: string; updated_at: string; owner_email: string | null };
type Res = { counts: Record<string, number>; rows: Row[] };
const SEV_TONE: Record<string, Tone> = { sev1: "danger", sev2: "danger", sev3: "attention", sev4: "neutral" };
const ST_TONE: Record<string, Tone> = { open: "danger", investigating: "attention", contained: "info", resolved: "positive" };
const TABS = [{ key: "active", label: "Active" }, { key: "resolved", label: "Resolved" }, { key: "all", label: "All" }];

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ s?: string; ok?: string; err?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.s) ? sp.s! : "active";
  const res = await consoleRpc<Res>(session, "console_incident_list", { p_status: tab === "all" ? null : tab, p_limit: 50 });
  const c = res.ok ? res.data.counts : {};
  const active = (c.open ?? 0) + (c.investigating ?? 0) + (c.contained ?? 0);
  const rows = res.ok ? res.data.rows : [];
  return (
    <>
      <PageHeader title="Incidents" subtitle="Declare and track operational and security incidents. A dashboard alert is a signal to investigate, not proof; record the detection source honestly." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Active incidents" value={active} tone={active > 0 ? "attention" : undefined} href="/security/incidents?s=active" />
        <KpiCard label="Investigating" value={c.investigating ?? 0} />
        <KpiCard label="Contained" value={c.contained ?? 0} />
        <KpiCard label="Resolved" value={c.resolved ?? 0} href="/security/incidents?s=resolved" />
      </div>
      <Card title="Declare an incident" className="mb-4">
        <form action={declareIncident} className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <label className="text-sm md:col-span-3"><span className="mb-1 block text-text-2">Title</span><input name="title" required minLength={3} maxLength={160} className={`${inputCls} w-full`} placeholder="What is happening?" /></label>
          <label className="text-sm"><span className="mb-1 block text-text-2">Severity</span>
            <select name="severity" defaultValue="sev3" className={`${inputCls} w-full`}><option value="sev1">Sev 1 - critical</option><option value="sev2">Sev 2 - major</option><option value="sev3">Sev 3 - minor</option><option value="sev4">Sev 4 - low</option></select></label>
          <label className="text-sm"><span className="mb-1 block text-text-2">Category</span>
            <select name="category" className={`${inputCls} w-full`}>{["availability", "data_integrity", "security", "third_party", "other"].map((x) => <option key={x} value={x}>{humanizeAction(x)}</option>)}</select></label>
          <label className="text-sm"><span className="mb-1 block text-text-2">Detected by</span>
            <select name="source" className={`${inputCls} w-full`}>{["manual", "health_check", "customer_report", "monitoring"].map((x) => <option key={x} value={x}>{humanizeAction(x)}</option>)}</select></label>
          <label className="text-sm md:col-span-6"><span className="mb-1 block text-text-2">Summary (optional)</span><textarea name="summary" rows={2} maxLength={2000} className={`${inputCls} h-auto w-full py-2`} placeholder="Facts only: what was observed, when, and what is affected." /></label>
          <div className="md:col-span-6"><button className={buttonCls}>Declare incident</button></div>
        </form>
      </Card>
      <Tabs label="Incident status" active={tab} items={TABS.map((t) => ({ ...t, href: `/security/incidents?s=${t.key}` }))} />
      <Card padded={false}>
        {!res.ok ? <div className="p-4"><ErrorState message="Incidents could not be loaded." /></div> : rows.length === 0 ? <EmptyState message="No incidents here." hint="Nothing has been declared. That is a statement about records, not a guarantee that nothing is wrong; see System Health." /> : (
          <div className="p-1"><DataTable caption="Incidents" columns={["Incident", "Title", "Severity", "Status", "Category", "Detected by", "Owner", "Updated"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.ref}</td>
                <td className="px-3 py-2.5"><Link href={`/security/incidents/${r.id}`} className="font-medium text-accent hover:underline">{r.title}</Link></td>
                <td className="px-3 py-2.5"><StatusPill tone={SEV_TONE[r.severity]}>{r.severity.toUpperCase()}</StatusPill></td>
                <td className="px-3 py-2.5"><StatusPill tone={ST_TONE[r.status]}>{r.status}</StatusPill></td>
                <td className="px-3 py-2.5 text-text-2">{humanizeAction(r.category)}</td>
                <td className="px-3 py-2.5 text-text-2">{humanizeAction(r.detection_source)}</td>
                <td className="px-3 py-2.5 text-xs text-text-3">{r.owner_email ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{timeAgo(r.updated_at)}</td>
              </tr>
            ))}
          </DataTable></div>
        )}
      </Card>
    </>
  );
}
