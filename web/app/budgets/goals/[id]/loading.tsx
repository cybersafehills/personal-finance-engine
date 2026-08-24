import { Skeleton } from "../../../../components/Skeleton";

export default function GoalDetailLoading() {
  return (
    <div aria-busy="true" aria-label="Loading goal">
      <Skeleton className="mb-4 h-6 w-48" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    </div>
  );
}
