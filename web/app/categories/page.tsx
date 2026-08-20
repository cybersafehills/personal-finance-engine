import { getCategoryTotals } from "../../lib/queries";
import { PageHeader } from "../../components/PageHeader";
import { CategoryItem } from "../../components/CategoryItem";
import { EmptyState } from "../../components/EmptyState";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const categories = await getCategoryTotals();
  const grandTotal = categories.reduce((sum, c) => sum + c.totalRwf, 0);

  return (
    <div>
      <PageHeader title="Categories" subtitle="Where your money has gone, all time" />

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
