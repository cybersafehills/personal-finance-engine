import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { getDirectoryAccess } from "../../../../lib/pay/directory-perms";
import { listInstitutions } from "../../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

export default async function InstitutionsListPage() {
  const access = await getDirectoryAccess();
  if (!access.canViewAdmin) notFound();

  const institutions = await listInstitutions();

  return (
    <div>
      <PageHeader
        title="Institutions & Providers"
        subtitle="Network participation is per-institution and independently verified"
        backHref="/admin/directory"
        backLabel="Directory Management"
        action={
          access.has("directory.create") ? (
            <Link
              href="/admin/directory/institutions/participation/new"
              className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
            >
              New participation
            </Link>
          ) : undefined
        }
      />

      {institutions.length === 0 ? (
        <EmptyState title="No providers yet" />
      ) : (
        <ul>
          {institutions.map((i) => (
            <li key={i.id} className="border-b border-border-subtle py-2.5 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-text-primary">{i.display_name}</span>
                  <span className="ml-2 font-mono text-xs text-text-muted">{i.slug}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="neutral">{i.kind}</Badge>
                  {i.emoney_issuer && <Badge variant="neutral">e-money</Badge>}
                </div>
              </div>
              {i.participation.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {i.participation.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/admin/directory/institutions/participation/${p.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-text-secondary"
                      >
                        {p.network_slug}
                        <Badge variant={p.state === "published" ? "positive" : "neutral"}>
                          {p.state}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
