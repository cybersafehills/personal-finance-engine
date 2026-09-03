import { Skeleton } from "../../../components/Skeleton";

export default function AccountantLoading() {
  return (
    <div aria-busy="true" aria-label="Loading accountant packages">
      <Skeleton className="mb-4 h-6 w-48" />
      <Skeleton className="mb-6 h-40 rounded-card" />
      <Skeleton className="mb-2 h-5 w-24" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-card" />
        ))}
      </div>
    </div>
  );
}
