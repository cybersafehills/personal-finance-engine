import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { AccountantPackageForm } from "../../../components/AccountantPackageForm";
import { formatDateTime } from "../../../lib/format";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isAccountantPackageEnabled } from "../../../lib/integrations/gate";
import { listAccountantPackages } from "../../../lib/integrations/queries";
import type { AccountantPackageStatus } from "../../../lib/integrations/accountant/model";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<AccountantPackageStatus, string> = {
  queued: "Queued",
  building: "Building…",
  ready: "Ready",
  failed: "Failed",
};

function variant(s: AccountantPackageStatus): "neutral" | "attention" | "positive" {
  if (s === "failed") return "attention";
  if (s === "ready") return "positive";
  return "neutral";
}

function sizeLabel(bytes: number | null): string {
  if (!bytes) return "";
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export default async function AccountantPackagesPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isAccountantPackageEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader
          title="Accountant package"
          backHref="/integrations"
          backLabel="Integrations"
        />
        <EmptyState title="Accountant packages aren’t enabled for this Space" />
      </div>
    );
  }

  const packages = await listAccountantPackages();

  return (
    <div>
      <PageHeader
        title="Accountant package"
        subtitle="A period-scoped bundle your accountant can open directly."
        backHref="/integrations"
        backLabel="Integrations"
      />

      <AccountantPackageForm />

      <h2 className="mb-2 mt-8 text-sm font-semibold text-text-primary">History</h2>
      {packages.length === 0 ? (
        <EmptyState
          title="No packages yet"
          description="Build one above — it will appear here to download."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {packages.map((pkg) => (
            <li
              key={pkg.id}
              className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">
                  {pkg.periodStart} — {pkg.periodEnd}
                  {typeof pkg.rowCount === "number"
                    ? ` · ${pkg.rowCount} transactions`
                    : ""}
                </span>
                <span className="block text-xs text-text-muted">
                  {formatDateTime(pkg.requestedAt)}
                  {pkg.byteSize ? ` · ${sizeLabel(pkg.byteSize)}` : ""}
                  {pkg.status === "failed" &&
                    (pkg.error as { message?: string })?.message
                    ? ` · ${(pkg.error as { message?: string }).message}`
                    : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant={variant(pkg.status)}>
                  {STATUS_LABEL[pkg.status]}
                </Badge>
                {pkg.status === "ready" && pkg.storagePath && (
                  <a
                    href={`/api/integrations/accountant/${pkg.id}`}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Download
                  </a>
                )}
                {pkg.status === "ready" && !pkg.storagePath && (
                  <span className="text-xs text-text-muted">Expired</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
