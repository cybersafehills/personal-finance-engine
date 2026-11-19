import Link from "next/link";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Segmented,
  StatusPill,
} from "../../../../components/ui/primitives";
import { auditView, consoleRpc, requireSession } from "../../../../lib/console/access";
import { can } from "../../../../lib/console/permissions";
import { formatDateTime, PLAN_LABELS, timeAgo } from "../../../../lib/format";

export const metadata = { title: "Users" };

type Row = {
  id: string;
  customer_ref: string;
  display_name: string | null;
  status: "active" | "suspended";
  created_at: string;
  workspaces: number;
  top_plan: string | null;
  last_activity: string | null;
};
const PAGE = 25;
const STATUSES = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; bc?: string; bid?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.access, "view_customer_metadata")) {
    return (
      <>
        <PageHeader title="Users" />
        <ErrorState message="Your role does not include customer metadata." />
      </>
    );
  }
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 60);
  const status = sp.status === "active" || sp.status === "suspended" ? sp.status : "all";
  const bc = sp.bc && !Number.isNaN(Date.parse(sp.bc)) ? new Date(sp.bc).toISOString() : null;
  const bid = sp.bid && /^[0-9a-f-]{36}$/i.test(sp.bid) ? sp.bid : null;

  // Searching or opening the first page is an audited read of customer metadata.
  if (!bc) await auditView(session, "customer_directory.viewed", q ? "search" : "list");

  const res = await consoleRpc<Row[]>(session, "console_customer_directory", {
    p_search: q || null,
    p_status: status === "all" ? null : status,
    p_limit: PAGE,
    p_before_created: bc,
    p_before_id: bid,
  });

  const base = (st: string) =>
    `/customers/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(st !== "all" ? { status: st } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Account metadata only. No email, contact details or financial data is shown."
        actions={
          <Segmented
            label="Account status"
            active={status}
            items={STATUSES.map((s) => ({ ...s, href: base(s.key) }))}
          />
        }
      />
      <Card>
        <form action="/customers/users" className="mb-3 flex gap-2">
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name or customer reference"
            aria-label="Search customers"
            className="w-full max-w-sm rounded-control border border-border-strong bg-surface px-3 py-1.5 text-sm"
          />
          <button className="rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">Search</button>
          {q ? <Link href={base(status)} className="self-center text-sm text-accent underline">Clear</Link> : null}
        </form>
        {!res.ok ? (
          <ErrorState message="The directory could not be loaded." />
        ) : res.data.length === 0 ? (
          <EmptyState message="No customers match." />
        ) : (
          <>
            <DataTable
              caption="Customers, newest first"
              columns={["Customer", "Name", "Plan (assigned)", "Registered", "Last activity", "Workspaces", "Status"]}
            >
              {res.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-2 py-2 font-mono text-xs text-text-2">{r.customer_ref}</td>
                  <td className="px-2 py-2"><Link href={`/customers/users/${r.id}`} className="font-medium text-accent hover:underline">{r.display_name ?? "Unnamed"}</Link></td>
                  <td className="px-2 py-2 text-text-2">{r.top_plan ? (PLAN_LABELS[r.top_plan] ?? r.top_plan) : "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-text-2">{formatDateTime(r.created_at)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-text-2">{r.last_activity ? timeAgo(r.last_activity) : "None"}</td>
                  <td className="px-2 py-2 text-text-2">{r.workspaces}</td>
                  <td className="px-2 py-2">
                    <StatusPill tone={r.status === "active" ? "positive" : "attention"}>{r.status}</StatusPill>
                  </td>
                </tr>
              ))}
            </DataTable>
            {res.data.length === PAGE ? (
              <div className="mt-3 text-right">
                <Link
                  href={`${base(status)}${base(status).includes("?") && base(status).length > "/customers/users?".length ? "&" : ""}bc=${encodeURIComponent(res.data[res.data.length - 1].created_at)}&bid=${res.data[res.data.length - 1].id}`}
                  className="text-sm text-accent underline"
                >
                  Older customers →
                </Link>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
