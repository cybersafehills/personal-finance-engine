"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryBillExtraction } from "../../app/bills/actions";

// Re-queue a failed / stuck document for extraction. bill.review-gated
// server-side; the parent only renders this when the caller can review.

export function BillRetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await retryBillExtraction(id);
            if (result.ok) router.refresh();
            else setError(result.error);
          });
        }}
        className="min-h-11 rounded-control border border-border-strong px-4 text-sm font-medium text-text-primary disabled:opacity-50"
      >
        {isPending ? "Re-queuing…" : "Retry processing"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </div>
  );
}
