import { Skeleton } from "../../components/Skeleton";

export default function NotificationsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading notifications">
      <Skeleton className="mb-4 h-6 w-36" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
    </div>
  );
}
