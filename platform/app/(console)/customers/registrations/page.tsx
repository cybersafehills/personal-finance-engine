import Link from "next/link";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, Pager, Tabs, StatusPill, type Tone } from "../../../../components/ui/primitives";
import { auditView, consoleRpc, requireSession } from "../../../../lib/console/access";
import { formatDateTime } from "../../../../lib/format";

export const metadata = { title: "Registrations" };

type Row = { id: string; customer_ref: string; display_name: string | null; created_at: string; state: string; required_action: string };
type Res = { counts: Record<string, number>; rows: Row[] };
const PAGE = 25;
const STATES: { key: string; label: string; tone: Tone }[] = [
  { key: "pending_verification", label: "Pending verification", tone: "attention" },
  { key: "incomplete", label: "Incomplete", tone: "info" },
  { key: "verified", label: "Verified", tone: "positive" },
  { key: "restricted", label: "Restricted", tone: "danger" },
];
const tone = (s: string) => STATES.find((x) => x.key === s)?.tone ?? "neutral";
const label = (s: string) => STATES.find((x) => x.key === s)?.label ?? s;

export default async function RegistrationsPage({ searchParams }: { searchParams: Promise<{ state?: string; bc?: string; bid?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const state = STATES.some((s) => s.key === sp.state) ? sp.state! : "all";
  const bc = sp.bc && !Number.isNaN(Date.parse(sp.bc)) ? new Date(sp.bc).toISOString() : null;
  const bid = sp.bid && /^[0-9a-f-]{36}$/i.test(sp.bid) ? sp.bid : null;
  if (!bc) await auditView(session, "registrations.viewed", state);
  const res = await consoleRpc<Res>(session, "console_registrations", { p_state: state === "all" ? null : state, p_limit: PAGE, p_before_created: bc, p_before_id: bid });
  const counts = res.ok ? res.data.counts : {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const href = (k: string) => `/customers/registrations${k !== "all" ? `?state=${k}` : ""}`;
  const rows = res.ok ? res.data.rows : [];
  const last = rows.length === PAGE ? rows[rows.length - 1] : null;
  const next = last ? `/customers/registrations?${new URLSearchParams({ ...(state !== "all" ? { state } : {}), bc: last.created_at, bid: last.id })}` : null;

  return (
    <>
      <PageHeader title="Registrations" subtitle="Where each sign-up stands. Personal registrations are self-service; there is no manual approval queue, so none is shown." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATES.map((s) => (
          <KpiCard key={s.key} label={s.label} value={(counts[s.key] ?? 0).toLocaleString("en-US")} href={href(s.key)}
            hint={total ? `${Math.round(((counts[s.key] ?? 0) / total) * 100)}% of registrations` : undefined} />
        ))}
      </div>
      <Tabs label="Registration state" active={state} items={[{ key: "all", label: "All", href: href("all"), count: total }, ...STATES.map((s) => ({ key: s.key, label: s.label, href: href(s.key), count: counts[s.key] ?? 0 }))]} />
      <Card padded={false}>
        {!res.ok ? <div className="p-4"><ErrorState message="Registrations could not be loaded." /></div> : rows.length === 0 ? <EmptyState message="No registrations in this state." /> : (
          <div className="p-1">
            <DataTable caption="Registrations, newest first" columns={["Applicant", "Registered", "State", "Required action"]}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2.5">
                    <Link href={`/customers/users/${r.id}`} className="font-medium text-accent hover:underline">{r.display_name ?? "Unnamed"}</Link>
                    <span className="ml-2 font-mono text-xs text-text-3">{r.customer_ref}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{formatDateTime(r.created_at)}</td>
                  <td className="px-3 py-2.5"><StatusPill tone={tone(r.state)}>{label(r.state)}</StatusPill></td>
                  <td className="px-3 py-2.5 text-text-2">{r.required_action}</td>
                </tr>
              ))}
            </DataTable>
            <div className="px-3 pb-3"><Pager nextHref={next} prevHref={bc ? href(state) : null} summary={`${rows.length} shown`} /></div>
          </div>
        )}
      </Card>
    </>
  );
}
