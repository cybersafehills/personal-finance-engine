import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { Badge } from "../../../components/Badge";
import { getDirectoryAccess } from "../../../lib/pay/directory-perms";
import { getDirectoryDashboard } from "../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

const STATE_VARIANT: Record<string, "neutral" | "positive" | "attention"> = {
  published: "positive",
  draft: "neutral",
  pending_review: "attention",
  temporarily_unavailable: "attention",
  deprecated: "neutral",
  archived: "neutral",
};

export default async function DirectoryAdminHome() {
  const access = await getDirectoryAccess();
  if (!access.canViewAdmin) notFound();

  const dash = await getDirectoryDashboard();
  const c = dash.counts;

  return (
    <div>
      <PageHeader
        title="Directory Management"
        subtitle="Payment networks, institutions, and access routes"
      />

      <nav className="mb-6 flex flex-wrap gap-2">
        <SubNav href="/admin/directory/networks" label="Payment Networks" />
        <SubNav href="/admin/directory/institutions" label="Institutions & Providers" />
        <SubNav href="/admin/directory/routes" label="Access Routes" />
        <SubNav href="/admin/directory/suggestions" label="Suggestions & Reports" />
        <SubNav href="/admin/directory/sources" label="Sources & Authorities" />
        <SubNav href="/admin/ussd" label="USSD Codes" />
        {access.isPlatformAdmin && (
          <SubNav href="/admin/directory/permissions" label="Permissions" />
        )}
      </nav>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">Overview</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Published networks" count={c.networksPublished} />
          <Stat label="Drafts" count={c.drafts} />
          <Stat label="Pending review" count={c.pendingReview} />
          <Stat label="Re-verification due" count={c.reviewDue} tone={c.reviewDue > 0 ? "attention" : undefined} />
          <Stat
            label="Published but unverified"
            count={c.unverifiedPublished}
            tone={c.unverifiedPublished > 0 ? "attention" : undefined}
          />
          <Stat label="Live entries without evidence" count={c.withoutEvidence} tone={c.withoutEvidence > 0 ? "attention" : undefined} />
        </div>
      </section>

      <Group heading="Payment networks" viewAllHref="/admin/directory/networks">
        {dash.networks.slice(0, 8).map((n) => (
          <Row
            key={n.id}
            href={`/admin/directory/networks/${n.id}`}
            title={n.canonical_name}
            meta={n.entity_type.replace(/_/g, " ")}
            state={n.state}
            unverified={n.verified_at == null}
          />
        ))}
        {dash.networks.length === 0 && <Empty />}
      </Group>

      <Group heading="Institution participation" viewAllHref="/admin/directory/institutions">
        {dash.participation.slice(0, 8).map((p) => (
          <Row
            key={p.id}
            href={`/admin/directory/institutions/participation/${p.id}`}
            title={`${p.provider?.display_name ?? "?"} → ${p.network?.canonical_name ?? "?"}`}
            meta={p.participant_role}
            state={p.state}
            unverified={p.verified_at == null}
          />
        ))}
        {dash.participation.length === 0 && <Empty />}
      </Group>

      <Group heading="Access routes" viewAllHref="/admin/directory/routes">
        {dash.routes.slice(0, 8).map((r) => (
          <Row
            key={r.id}
            href={`/admin/directory/routes/${r.id}`}
            title={r.display_name_en}
            meta={`${r.channel} · ${r.provider?.display_name ?? "?"}`}
            state={r.state}
            unverified={r.verified_at == null}
          />
        ))}
        {dash.routes.length === 0 && <Empty />}
      </Group>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">Recent changes</h2>
        {dash.recentAudit.length === 0 ? (
          <Empty />
        ) : (
          <ul className="text-sm">
            {dash.recentAudit.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
              >
                <span className="font-mono text-xs text-text-secondary">{a.action}</span>
                <span className="flex-1 truncate text-text-secondary">{a.reason ?? "—"}</span>
                <span className="shrink-0 text-xs text-text-muted">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SubNav({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-text-primary"
    >
      {label}
    </Link>
  );
}

function Stat({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone?: "attention";
}) {
  return (
    <div className="rounded-control border border-border-subtle bg-surface px-3 py-2.5">
      <p
        className={`text-2xl font-semibold ${tone === "attention" ? "text-attention" : "text-text-primary"}`}
      >
        {count}
      </p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}

function Group({
  heading,
  viewAllHref,
  children,
}: {
  heading: string;
  viewAllHref: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-secondary">{heading}</h2>
        <Link href={viewAllHref} className="text-xs font-medium text-accent">
          View all
        </Link>
      </div>
      <ul>{children}</ul>
    </section>
  );
}

function Row({
  href,
  title,
  meta,
  state,
  unverified,
}: {
  href: string;
  title: string;
  meta: string;
  state: string;
  unverified: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border-subtle py-2.5 last:border-b-0">
      <Link href={href} className="min-w-0 flex-1">
        <span className="font-medium text-text-primary">{title}</span>
        <span className="ml-2 text-xs text-text-muted">{meta}</span>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        {unverified && <Badge variant="attention">Unverified</Badge>}
        <Badge variant={STATE_VARIANT[state] ?? "neutral"}>{state}</Badge>
      </div>
    </li>
  );
}

function Empty() {
  return <li className="py-2 text-sm text-text-muted">Nothing yet.</li>;
}
