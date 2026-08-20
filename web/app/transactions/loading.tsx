import { Skeleton } from "../../components/Skeleton";

export default function TransactionsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading transactions">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    </div>
  );
}
