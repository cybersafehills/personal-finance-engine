import { Skeleton } from "../../../components/Skeleton";

export default function ConnectionsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading connections">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
    </div>
  );
}
