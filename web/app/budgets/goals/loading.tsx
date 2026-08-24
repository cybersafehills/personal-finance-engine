import { Skeleton } from "../../../components/Skeleton";

export default function GoalsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading goals">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
    </div>
  );
}
