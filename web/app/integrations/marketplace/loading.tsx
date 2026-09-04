import { Skeleton } from "../../../components/Skeleton";

export default function MarketplaceLoading() {
  return (
    <div aria-busy="true" aria-label="Loading marketplace">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-card" />
        ))}
      </div>
      <div className="flex flex-col gap-8">
        {Array.from({ length: 3 }).map((_, section) => (
          <div key={section}>
            <Skeleton className="mb-2 h-5 w-32" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, row) => (
                <Skeleton key={row} className="h-24 rounded-card" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
