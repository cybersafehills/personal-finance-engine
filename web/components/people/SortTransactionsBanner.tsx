"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { sortTransactionsAction } from "../../app/people/actions";

/**
 * Shown while some transactions aren't yet attached to a person or merchant.
 * Members get it sorted automatically once when the page opens (the backfill is
 * idempotent and only adds links - raw labels never change); "Sort them now" is
 * the retry if that fails. Viewers just see the count.
 */
export function SortTransactionsBanner({ count, canWrite }: { count: number; canWrite: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const autoStarted = useRef(false);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await sortTransactionsAction();
      if (!res.ok) setError(res.error);
      else {
        setDone(true);
        router.refresh();
      }
    });
  }

  // Once per visit. Not retried on failure (that would loop); the button is the retry.
  useEffect(() => {
    if (canWrite && count > 0 && !autoStarted.current) {
      autoStarted.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              onClick={run}
            >
              {pending ? "Sorting…" : error ? "Try again" : "Sort them now"}
            </button>
          </div>
        )
        : <p className="text-xs text-text-muted">A member of this Space can sort them.</p>}
    </div>
  );
}
