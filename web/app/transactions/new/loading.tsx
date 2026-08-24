import { Skeleton } from "../../../components/Skeleton";

export default function NewTransactionLoading() {
  return (
    <div aria-busy="true" aria-label="Loading form">
      <Skeleton className="mb-4 h-6 w-40" />
      <Skeleton className="h-96 rounded-card" />
    </div>
  );
}
