import { Skeleton } from "../../../components/Skeleton";

export default function BudgetDetailLoading() {
  return (
    <div aria-busy="true" aria-label="Loading budget">
      <Skeleton className="mb-4 h-6 w-48" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    </div>
  );
}
