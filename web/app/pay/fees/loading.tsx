import { Skeleton } from "../../../components/Skeleton";

export default function FeesLoading() {
  return (
    <div aria-busy="true" aria-label="Loading fee estimate">
      <Skeleton className="mb-4 h-6 w-56" />
      <Skeleton className="mb-4 h-32" />
      <Skeleton className="h-40" />
    </div>
  );
}
