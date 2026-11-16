import Link from "next/link";
import {
  getCategoryTotalsComplete,
  getSpaceCategoryManagement,
} from "../../lib/queries";
import { PageHeader } from "../../components/PageHeader";
import { CategoryItem } from "../../components/CategoryItem";
import { SpaceCategoriesPanel } from "../../components/SpaceCategoriesPanel";
import { EmptyState } from "../../components/EmptyState";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  // The complete, paged totals (a single request silently stopped at 1000 rows).
  // A failed read still shows an empty list here, as it always has.
  const [{ totals: categories }, spaceCategories] = await Promise.all([
    getCategoryTotalsComplete().catch((error: Error) => {
      console.error("getCategoryTotals failed:", error.message);
      return { totals: [], truncated: false };
    }),
    getSpaceCategoryManagement(true),
  ]);
  const grandTotal = categories.reduce((sum, c) => sum + c.totalRwf, 0);

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Where your money has gone, all time"
        action={
          <Link href="/categories/rules" className="text-sm font-medium text-accent">
            Manage rules
          </Link>
        }
      />

      {spaceCategories && (
        <SpaceCategoriesPanel
          categories={spaceCategories.categories}
          canManage={spaceCategories.canManage}
          scope={spaceCategories.scope}
        />
      )}

      <section className="rounded-card border border-border-subtle bg-surface p-1.5">
        {categories.length === 0 ? (
          <EmptyState
            title="No spending yet"
            description="Categories appear here once transactions come in."
          />
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle">
            {categories.map((category) => (
              <CategoryItem
                key={category.category}
                category={category}
                share={grandTotal > 0 ? category.totalRwf / grandTotal : 0}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
