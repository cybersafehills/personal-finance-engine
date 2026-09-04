import { Skeleton } from "../../../components/Skeleton";

export default function DeveloperLoading() {
  return (
    <div aria-busy="true" aria-label="Loading developer API">
      <Skeleton className="mb-4 h-6 w-40" />
      <Skeleton className="mb-6 h-16 rounded-card" />
      <Skeleton className="mb-2 h-5 w-24" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
    </div>
  );
}
