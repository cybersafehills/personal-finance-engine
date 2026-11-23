import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, ErrorState, PageHeader, StatusPill, DataTable, EmptyState } from "../../../../../components/ui/primitives";
import { Icon } from "../../../../../components/ui/Icon";
import { auditView, consoleRpc, requireSession } from "../../../../../lib/console/access";
import { formatDate, formatDateTime, PLAN_LABELS, timeAgo } from "../../../../../lib/format";

export const metadata = { title: "Customer" };

type Detail = {
  customer_ref: string; display_name: string | null; status: "active" | "suspended"; created_at: string;
  locale: string; timezone: string; onboarding_step: string; email_confirmed: boolean; mfa_enrolled: boolean; last_sign_in_at: string | null;
  workspaces: { ref: string; name: string; kind: string; member_role: string; status: string; plan: string | null; accounts: number; connections: number; last_activity: string | null }[];
};

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await requireSession();
  const res = await consoleRpc<Detail>(session, "console_customer_detail", { p_id: id });
  if (!res.ok) return (<><PageHeader title="Customer" /><ErrorState message="This customer could not be loaded." /></>);
  await auditView(session, "customer.viewed", id.slice(0, 8));
  const c = res.data;
  const fact = (k: string, v: React.ReactNode) => (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0"><dt className="text-text-3">{k}</dt><dd className="text-right">{v}</dd></div>
  );
  return (
    <>
      <Link href="/customers/users" className="mb-3 inline-flex items-center gap-1 text-sm text-text-3 hover:text-text"><Icon name="prev" size={14} /> All users</Link>
      <PageHeader title={c.display_name ?? "Unnamed customer"} subtitle={`Customer ${c.customer_ref} · metadata only; no email, contact or financial data is shown.`}
        actions={<StatusPill tone={c.status === "active" ? "positive" : "attention"}>{c.status}</StatusPill>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card title="Account"><dl>
          {fact("Registered", formatDate(c.created_at))}
          {fact("Email verified", <StatusPill tone={c.email_confirmed ? "positive" : "attention"}>{c.email_confirmed ? "Yes" : "Not yet"}</StatusPill>)}
          {fact("Onboarding", c.onboarding_step === "completed" ? "Completed" : `In progress (${c.onboarding_step})`)}
          {fact("Two-step sign-in", <StatusPill tone={c.mfa_enrolled ? "positive" : "neutral"}>{c.mfa_enrolled ? "Enrolled" : "Not enrolled"}</StatusPill>)}
          {fact("Last sign-in", c.last_sign_in_at ? `${formatDateTime(c.last_sign_in_at)} (${timeAgo(c.last_sign_in_at)})` : "Never")}
          {fact("Locale / timezone", `${c.locale} · ${c.timezone}`)}
        </dl></Card>
        <Card title="Workspaces" subtitle="Where this customer is an active member" padded={false}>
          {c.workspaces.length === 0 ? <EmptyState message="No active workspace memberships." /> : (
            <div className="p-1"><DataTable caption="Customer workspaces" columns={["Workspace", "Type", "Their role", "Plan", "Accounts", "Connections", "Last activity"]}>
              {c.workspaces.map((w) => (
                <tr key={w.ref}>
                  <td className="px-3 py-2.5"><span className="font-medium">{w.name}</span><span className="ml-2 font-mono text-xs text-text-3">{w.ref}</span></td>
                  <td className="px-3 py-2.5 capitalize text-text-2">{w.kind}</td>
                  <td className="px-3 py-2.5 capitalize text-text-2">{w.member_role}</td>
                  <td className="px-3 py-2.5 text-text-2">{w.plan ? (PLAN_LABELS[w.plan] ?? w.plan) : "—"}</td>
                  <td className="px-3 py-2.5 text-text-2">{w.accounts}</td>
                  <td className="px-3 py-2.5 text-text-2">{w.connections}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{w.last_activity ? timeAgo(w.last_activity) : "None"}</td>
                </tr>
              ))}
            </DataTable></div>
          )}
        </Card>
      </div>
    </>
  );
}
