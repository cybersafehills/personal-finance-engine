import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { getDirectoryAccess } from "../../../../lib/pay/directory-perms";
import { listPaymentNetworks } from "../../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

export default async function PaymentNetworksListPage() {
  const access = await getDirectoryAccess();
  if (!access.canViewAdmin) notFound();

  const networks = await listPaymentNetworks();

  return (
    <div>
      <PageHeader
        title="Payment Networks"
        backHref="/admin/directory"
        backLabel="Directory Management"
        action={
          access.has("directory.create") ? (
            <Link
              href="/admin/directory/networks/new"
              className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
            >
              New network
            </Link>
          ) : undefined
        }
      />

      {networks.length === 0 ? (
        <EmptyState title="No payment networks yet" description="Create the first one." />
      ) : (
        <ul>
          {networks.map((n) => (
            <li
              key={n.id}
              className="flex items-center justify-between gap-3 border-b border-border-subtle py-2.5 last:border-b-0"
            >
              <Link href={`/admin/directory/networks/${n.id}`} className="min-w-0 flex-1">
                <span className="font-medium text-text-primary">{n.canonical_name}</span>
                <span className="ml-2 font-mono text-xs text-text-muted">{n.slug}</span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {n.verified_at == null && <Badge variant="attention">Unverified</Badge>}
                <Badge variant={n.state === "published" ? "positive" : "neutral"}>{n.state}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
