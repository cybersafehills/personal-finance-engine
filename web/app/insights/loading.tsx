import { Skeleton } from "../../components/Skeleton";

export default function InsightsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading insights">
      <Skeleton className="mb-4 h-6 w-40" />
      <Skeleton className="mb-4 h-28" />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    </div>
  );
}
