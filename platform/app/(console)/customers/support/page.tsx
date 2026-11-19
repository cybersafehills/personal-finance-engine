import Link from "next/link";
import { Flash } from "../../../../components/ui/Flash";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, Pager, StatusPill, Tabs, buttonCls, inputCls, type Tone } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { formatDateTime, humanizeAction, timeAgo } from "../../../../lib/format";
import { createTicket } from "./actions";

export const metadata = { title: "Customer Support" };

type Row = { id: string; ref: string; subject: string; category: string; priority: string; status: string; created_at: string; updated_at: string; customer_ref: string | null; assignee_email: string | null };
type Res = { counts: Record<string, number>; rows: Row[] };
const PAGE = 25;
const PRIORITY_TONE: Record<string, Tone> = { low: "neutral", normal: "info", high: "attention", urgent: "danger" };
const STATUS_TONE: Record<string, Tone> = { open: "info", in_progress: "info", waiting: "neutral", escalated: "danger", resolved: "positive", closed: "neutral" };
const CATEGORIES = ["account_access", "subscription_billing", "payment_issue", "transaction_import", "wallet_configuration", "application_malfunction", "security_concern", "feature_assistance"];
const TABS = [{ key: "active", label: "Active" }, { key: "escalated", label: "Escalated" }, { key: "resolved", label: "Resolved" }, { key: "closed", label: "Closed" }, { key: "all", label: "All" }];

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ s?: string; before?: string; ok?: string; err?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.s) ? sp.s! : "active";
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before).toISOString() : null;
  const res = await consoleRpc<Res>(session, "console_support_list", { p_status: tab === "all" ? null : tab, p_limit: PAGE, p_before: before });
  const counts = res.ok ? res.data.counts : {};
  const active = (counts.open ?? 0) + (counts.in_progress ?? 0) + (counts.waiting ?? 0) + (counts.escalated ?? 0);
  const rows = res.ok ? res.data.rows : [];
  const last = rows.length === PAGE ? rows[rows.length - 1].updated_at : null;
  const href = (k: string) => `/customers/support?s=${k}`;

  return (
    <>
      <PageHeader title="Customer Support" subtitle="Staff-logged tickets. Customers cannot file tickets yet, so every ticket here was created by a team member. Notes are visible to support staff only." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Active tickets" value={active} href={href("active")} />
        <KpiCard label="Escalated" value={counts.escalated ?? 0} tone={(counts.escalated ?? 0) > 0 ? "danger" : undefined} href={href("escalated")} />
        <KpiCard label="Waiting" value={counts.waiting ?? 0} />
        <KpiCard label="Resolved" value={counts.resolved ?? 0} href={href("resolved")} />
      </div>

      <Card title="Log a ticket" subtitle="Record an issue reported to you by phone, email or in person." className="mb-4">
        <form action={createTicket} className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <label className="text-sm md:col-span-3"><span className="mb-1 block text-text-2">Subject</span>
            <input name="subject" required minLength={3} maxLength={160} className={`${inputCls} w-full`} placeholder="Short summary of the problem" /></label>
          <label className="text-sm md:col-span-2"><span className="mb-1 block text-text-2">Category</span>
            <select name="category" required className={`${inputCls} w-full`}>{CATEGORIES.map((c) => <option key={c} value={c}>{humanizeAction(c)}</option>)}</select></label>
          <label className="text-sm"><span className="mb-1 block text-text-2">Priority</span>
            <select name="priority" defaultValue="normal" className={`${inputCls} w-full`}>{["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{humanizeAction(p)}</option>)}</select></label>
          <label className="text-sm md:col-span-6"><span className="mb-1 block text-text-2">Details (optional, visible to support staff only)</span>
            <textarea name="body" maxLength={2000} rows={2} className={`${inputCls} h-auto w-full py-2`} placeholder="What was reported? Do not paste passwords, PINs or full card or account numbers." /></label>
          <label className="text-sm md:col-span-4"><span className="mb-1 block text-text-2">Customer ID (optional full UUID, from the Users page)</span>
            <input name="customer_id" pattern="[0-9a-fA-F-]{36}" className={`${inputCls} w-full font-mono text-xs`} placeholder="Leave blank if not tied to a customer" /></label>
          <div className="flex items-end md:col-span-2"><button className={`${buttonCls} w-full`}>Log ticket</button></div>
        </form>
      </Card>

      <Tabs label="Ticket status" active={tab} items={TABS.map((t) => ({ ...t, href: href(t.key) }))} />
      <Card padded={false}>
        {!res.ok ? <div className="p-4"><ErrorState message="Tickets could not be loaded." /></div> : rows.length === 0 ? <EmptyState message="No tickets here." hint="Log a ticket above when a customer reports a problem." /> : (
          <div className="p-1">
            <DataTable caption="Support tickets" columns={["Ticket", "Subject", "Category", "Priority", "Status", "Assigned", "Updated"]}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.ref}</td>
                  <td className="px-3 py-2.5"><Link href={`/customers/support/${r.id}`} className="font-medium text-accent hover:underline">{r.subject}</Link>{r.customer_ref ? <span className="ml-2 font-mono text-[11px] text-text-3">cust {r.customer_ref}</span> : null}</td>
                  <td className="px-3 py-2.5 text-text-2">{humanizeAction(r.category)}</td>
                  <td className="px-3 py-2.5"><StatusPill tone={PRIORITY_TONE[r.priority]}>{r.priority}</StatusPill></td>
                  <td className="px-3 py-2.5"><StatusPill tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</StatusPill></td>
                  <td className="px-3 py-2.5 text-xs text-text-3">{r.assignee_email ?? "Unassigned"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-text-2" title={formatDateTime(r.updated_at)}>{timeAgo(r.updated_at)}</td>
                </tr>
              ))}
            </DataTable>
            <div className="px-3 pb-3"><Pager nextHref={last ? `${href(tab)}&before=${encodeURIComponent(last)}` : null} prevHref={before ? href(tab) : null} summary={`${rows.length} shown`} /></div>
          </div>
        )}
      </Card>
    </>
  );
}
