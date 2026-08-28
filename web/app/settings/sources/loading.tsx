import { Skeleton } from "../../../components/Skeleton";

export default function SourcesLoading() {
  return (
    <div aria-busy="true" aria-label="Loading shared accounts">
      <Skeleton className="mb-4 h-6 w-44" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
    </div>
  );
}
