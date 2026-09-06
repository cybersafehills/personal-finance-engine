import Link from "next/link";
import {
  getActiveWorkspaceId,
  getCategoryMappings,
  getUncategorizedOutflowSummary,
} from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { CategoryMappingItem } from "../../../components/CategoryMappingItem";
import { formatRwf } from "../../../lib/format";

export const dynamic = "force-dynamic";

export default async function CategoryMappingsPage() {
  const workspaceId = await getActiveWorkspaceId();
  const [categories, uncategorized] = await Promise.all([
    getCategoryMappings(),
    workspaceId
      ? getUncategorizedOutflowSummary(workspaceId)
      : Promise.resolve({ count: 0, totalRwf: 0 }),
  ]);
  const unmappedCount = categories.filter((c) => c.allocationType === null).length;

  return (
    <div>
      <PageHeader
        title="Category mappings"
        subtitle="Map each spending category to a budget allocation"
      />

      {unmappedCount > 0 && (
        <div className="mb-4 rounded-control bg-attention-bg px-3 py-2 text-sm font-medium text-attention">
          {unmappedCount} categor{unmappedCount === 1 ? "y is" : "ies are"} not mapped
          to an allocation yet - their spending won&apos;t count toward any
          budget target until you map them below.
        </div>
      )}

      {uncategorized.count > 0 && (
        <Link
          href="/transactions/review"
          className="mb-4 flex flex-col gap-1 rounded-card border border-needs-map-border bg-needs-map-bg p-4 transition-colors hover:bg-surface"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-text-primary">
              Uncategorized transactions
            </span>
            <span className="text-xs text-text-muted">
              {uncategorized.count} transaction{uncategorized.count === 1 ? "" : "s"} · {formatRwf(uncategorized.totalRwf)}
            </span>
          </div>
          <p className="text-sm text-text-secondary">
            Give these a category in the review queue so they can be mapped to a
            budget allocation. →
          </p>
        </Link>
      )}

      {categories.length === 0 ? (
        <EmptyState
          title="No categorized spending yet"
          description="Once transactions have categories, they'll appear here to map to a budget allocation."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {categories.map((row) => (
            <CategoryMappingItem key={row.category} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
