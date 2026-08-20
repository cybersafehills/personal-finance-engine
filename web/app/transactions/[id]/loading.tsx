import { Skeleton } from "../../../components/Skeleton";

export default function TransactionDetailLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading transaction">
      <Skeleton className="h-36 rounded-card" />
      <Skeleton className="h-40 rounded-card" />
      <Skeleton className="h-28 rounded-card" />
    </div>
  );
}
