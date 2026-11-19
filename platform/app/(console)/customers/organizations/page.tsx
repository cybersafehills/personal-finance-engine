import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, Pager, StatusPill, buttonCls, inputCls } from "../../../../components/ui/primitives";
import { auditView, consoleRpc, requireSession } from "../../../../lib/console/access";
import { formatDateTime, PLAN_LABELS, timeAgo } from "../../../../lib/format";

export const metadata = { title: "Organizations" };

type Row = { id: string; org_ref: string; name: string; status: string; created_at: string; members: number; plan: string | null; last_activity: string | null };
type Res = { totals: { organizations: number; active: number }; rows: Row[] };
const PAGE = 25;

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ q?: string; bc?: string; bid?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 60);
  const bc = sp.bc && !Number.isNaN(Date.parse(sp.bc)) ? new Date(sp.bc).toISOString() : null;
  const bid = sp.bid && /^[0-9a-f-]{36}$/i.test(sp.bid) ? sp.bid : null;
  if (!bc) await auditView(session, "organizations.viewed", q ? "search" : "list");
  const res = await consoleRpc<Res>(session, "console_organizations", { p_search: q || null, p_limit: PAGE, p_before_created: bc, p_before_id: bid });
  const rows = res.ok ? res.data.rows : [];
  const last = rows.length === PAGE ? rows[rows.length - 1] : null;
  const next = last ? `/customers/organizations?${new URLSearchParams({ ...(q ? { q } : {}), bc: last.created_at, bid: last.id })}` : null;
  return (
    <>
      <PageHeader title="Organizations" subtitle="Business workspaces. Names and counts only; no financial data." />
      {res.ok ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Organizations" value={res.data.totals.organizations} />
          <KpiCard label="Active" value={res.data.totals.active} />
        </div>
      ) : null}
      <Card padded={false}>
        <form action="/customers/organizations" className="flex gap-2 border-b border-border p-3">
          <input name="q" defaultValue={q} placeholder="Search by organization name or reference" aria-label="Search organizations" className={`${inputCls} w-full max-w-sm`} />
          <button className={buttonCls}>Search</button>
        </form>
        {!res.ok ? <div className="p-4"><ErrorState message="Organizations could not be loaded." /></div> : rows.length === 0 ? <EmptyState message="No organizations match." hint="Business workspaces appear here once customers create them." /> : (
          <div className="p-1">
            <DataTable caption="Organizations, newest first" columns={["Organization", "Plan (assigned)", "Members", "Created", "Last activity", "Status"]}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2.5"><span className="font-medium">{r.name}</span><span className="ml-2 font-mono text-xs text-text-3">{r.org_ref}</span></td>
                  <td className="px-3 py-2.5 text-text-2">{r.plan ? (PLAN_LABELS[r.plan] ?? r.plan) : "—"}</td>
                  <td className="px-3 py-2.5 text-text-2">{r.members}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{formatDateTime(r.created_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{r.last_activity ? timeAgo(r.last_activity) : "None"}</td>
                  <td className="px-3 py-2.5"><StatusPill tone={r.status === "active" ? "positive" : "attention"}>{r.status}</StatusPill></td>
                </tr>
              ))}
            </DataTable>
            <div className="px-3 pb-3"><Pager nextHref={next} prevHref={bc ? `/customers/organizations${q ? `?q=${encodeURIComponent(q)}` : ""}` : null} summary={`${rows.length} shown`} /></div>
          </div>
        )}
      </Card>
    </>
  );
}
