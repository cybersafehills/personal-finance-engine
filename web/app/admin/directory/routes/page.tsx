import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { getDirectoryAccess } from "../../../../lib/pay/directory-perms";
import { listAccessRoutes } from "../../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

export default async function AccessRoutesListPage() {
  const access = await getDirectoryAccess();
  if (!access.canViewAdmin) notFound();

  const routes = await listAccessRoutes();

  return (
    <div>
      <PageHeader
        title="Access Routes"
        subtitle="Institution-specific ways to reach a network — each independently verified"
        backHref="/admin/directory"
        backLabel="Directory Management"
        action={
          access.has("directory.create") ? (
            <Link
              href="/admin/directory/routes/new"
              className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
            >
              New route
            </Link>
          ) : undefined
        }
      />

      {routes.length === 0 ? (
        <EmptyState
          title="No access routes yet"
          description="Routes are added per institution as verified evidence becomes available."
        />
      ) : (
        <ul>
          {routes.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 border-b border-border-subtle py-2.5 last:border-b-0"
            >
              <Link href={`/admin/directory/routes/${r.id}`} className="min-w-0 flex-1">
                <span className="font-medium text-text-primary">{r.display_name_en}</span>
                <span className="ml-2 text-xs text-text-muted">
                  {r.channel} · {r.provider?.display_name ?? "?"}
                  {r.network ? ` · ${r.network.canonical_name}` : ""}
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {r.verified_at == null && <Badge variant="attention">Unverified</Badge>}
                <Badge variant={r.state === "published" ? "positive" : "neutral"}>{r.state}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
