import { Skeleton } from "../../../components/Skeleton";

export default function ReviewQueueLoading() {
  return (
    <div aria-busy="true" aria-label="Loading review queue">
      <Skeleton className="mb-4 h-6 w-32" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
    </div>
  );
}
