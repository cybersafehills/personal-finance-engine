import { Skeleton } from "../../../../components/Skeleton";

export default function ImportStatementLoading() {
  return (
    <div aria-busy="true" aria-label="Loading statement import">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 rounded-control" />
        <Skeleton className="h-11 rounded-control" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    </div>
  );
}
