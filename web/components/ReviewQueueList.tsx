"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkConfirmTransactionCategories,
  bulkDismissSuggestedCategories,
} from "../app/transactions/review/actions";
import { ReviewQueueItem } from "./ReviewQueueItem";
import type { TransactionRow } from "../lib/queries";

export function ReviewQueueList({
  transactions,
  categorySuggestions = [],
}: {
  transactions: TransactionRow[];
  categorySuggestions?: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulk(action: (ids: string[]) => Promise<{ ok: true; succeededCount: number; failedCount: number }>) {
    setErrorMessage(null);
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await action(ids);
      if (result.failedCount > 0) {
        setErrorMessage(
          `${result.succeededCount} succeeded, ${result.failedCount} failed - reload and try the rest individually.`,
        );
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions for selected transactions"
          className="flex flex-wrap items-center gap-3 rounded-card border border-border-subtle bg-background p-3"
        >
          <span className="text-sm font-medium text-text-secondary">{selected.size} selected</span>
          <button
            type="button"
            disabled={isPending}
            onClick={() => runBulk(bulkConfirmTransactionCategories)}
            className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
          >
            Confirm selected
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => runBulk(bulkDismissSuggestedCategories)}
            className="min-h-9 text-xs font-medium text-text-muted disabled:opacity-50"
          >
            Dismiss selected
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="min-h-9 text-xs font-medium text-text-muted"
          >
            Clear
          </button>
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">{errorMessage}</p>
      )}

      {transactions.map((t) => (
        <ReviewQueueItem
          key={t.id}
          transaction={t}
          selected={selected.has(t.id)}
          onToggleSelect={toggleSelect}
          categorySuggestions={categorySuggestions}
        />
      ))}
    </div>
  );
}
