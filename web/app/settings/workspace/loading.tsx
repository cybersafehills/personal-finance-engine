import { Skeleton } from "../../../components/Skeleton";

export default function WorkspaceLoading() {
  return (
    <div aria-busy="true" aria-label="Loading Space">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12 rounded-card" />
        <Skeleton className="h-12 rounded-card" />
        <Skeleton className="h-32 rounded-card" />
      </div>
    </div>
  );
}
