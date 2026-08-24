import { Skeleton } from "../../../components/Skeleton";

export default function TransfersLoading() {
  return (
    <div aria-busy="true" aria-label="Loading possible transfers">
      <Skeleton className="mb-4 h-6 w-48" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
    </div>
  );
}
