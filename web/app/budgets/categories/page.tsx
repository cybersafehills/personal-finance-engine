import { getCategoryMappings } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { CategoryMappingItem } from "../../../components/CategoryMappingItem";

export const dynamic = "force-dynamic";

export default async function CategoryMappingsPage() {
  const categories = await getCategoryMappings();
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
