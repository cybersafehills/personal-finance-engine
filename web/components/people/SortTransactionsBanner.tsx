"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sortTransactionsAction } from "../../app/people/actions";

/**
 * Shown while some transactions aren't yet attached to a person or merchant.
 * "Sort them now" runs the idempotent backfill; safe to press again.
 */
export function SortTransactionsBanner({ count, canWrite }: { count: number; canWrite: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <p className="text-sm text-text-primary">
        {count} {count === 1 ? "transaction hasn't" : "transactions haven't"} been sorted into people and merchants yet.
      </p>
      {error ? <p role="alert" className="text-sm text-attention">{error}</p> : null}
      {done
        ? (
          <p role="status" className="text-sm text-text-secondary">
            Sorted. Anything still listed has no name or number to group it by.
          </p>
        )
        : canWrite
        ? (
          <div>
            <button
              type="button"
              disabled={pending}
              className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await sortTransactionsAction();
                  if (!res.ok) setError(res.error);
                  else {
                    setDone(true);
                    router.refresh();
                  }
                });
              }}
            >
              {pending ? "Sorting…" : "Sort them now"}
            </button>
          </div>
        )
        : <p className="text-xs text-text-muted">A member of this Space can sort them.</p>}
    </div>
  );
}
