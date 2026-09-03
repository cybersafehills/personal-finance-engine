import { Skeleton } from "../components/Skeleton";

export default function HomeLoading() {
  return (
    <div className="flex flex-col gap-5" role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-32 rounded-card" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20 rounded-card" />
        <Skeleton className="h-20 rounded-card" />
      </div>
      <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    </div>
  );
}
