import { Skeleton } from "../../components/Skeleton";

export default function IntegrationsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading integrations">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Skeleton className="h-20 rounded-card" />
        <Skeleton className="h-20 rounded-card" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
    </div>
  );
}
