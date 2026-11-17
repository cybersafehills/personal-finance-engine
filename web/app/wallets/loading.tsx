import { Skeleton } from "../../components/Skeleton";

export default function WalletsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading wallets">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    </div>
  );
}
