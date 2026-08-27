import { Skeleton } from "../../../components/Skeleton";

export default function Loading() {
  return (
    <div>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-72" />
      <Skeleton className="mt-4 h-11 w-full" />
      <div className="mt-5 flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
