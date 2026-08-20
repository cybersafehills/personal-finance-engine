import { Skeleton } from "../../components/Skeleton";

export default function CategoriesLoading() {
  return (
    <div aria-busy="true" aria-label="Loading categories">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    </div>
  );
}
