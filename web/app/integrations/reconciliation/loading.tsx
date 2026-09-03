import { Skeleton } from "../../../components/Skeleton";

export default function ReconciliationLoading() {
  return (
    <div aria-busy="true" aria-label="Loading reconciliation">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Skeleton className="h-20 rounded-card" />
        <Skeleton className="h-20 rounded-card" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
    </div>
  );
}
