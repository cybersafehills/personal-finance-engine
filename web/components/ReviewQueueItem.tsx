"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmTransactionCategory,
  dismissSuggestedCategory,
} from "../app/transactions/review/actions";
import { correctCategory } from "../app/categories/actions";
import { displayName } from "../lib/display-name";
import { formatDateTime } from "../lib/format";
import { MoneyAmount } from "./MoneyAmount";
import { Badge } from "./Badge";
import type { TransactionRow } from "../lib/queries";

const STATUS_LABELS: Record<string, string> = {
  provisional: "Provisional",
  suggested: "Suggested",
  conflict: "Conflict",
};

export function ReviewQueueItem({
  transaction,
  selected,
  onToggleSelect,
}: {
  transaction: TransactionRow;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [category, setCategory] = useState(
    transaction.suggested_category ?? transaction.category ?? "",
  );
  const [subcategory, setSubcategory] = useState(
    transaction.suggested_subcategory ?? transaction.subcategory ?? "",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (resolved) return null;

  const displayCategory = transaction.suggested_category ?? transaction.category;
  const canDismiss = transaction.category_decision_status !== "provisional";

  function handleConfirm() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await confirmTransactionCategory(transaction.id);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setResolved(true);
      router.refresh();
    });
  }

  function handleDismiss() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await dismissSuggestedCategory(transaction.id);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setResolved(true);
      router.refresh();
    });
  }

  function handleCorrect(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    startTransition(async () => {
      const result = await correctCategory(transaction.id, category, subcategory || null, false);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setResolved(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(transaction.id)}
            aria-label={`Select ${displayName(transaction)} for bulk action`}
            className="mt-0.5 h-4 w-4"
          />
          <div>
            <p className="text-sm font-medium text-text-primary">{displayName(transaction)}</p>
            <p className="text-xs text-text-muted">{formatDateTime(transaction.occurred_at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="attention">
            {STATUS_LABELS[transaction.category_decision_status] ?? transaction.category_decision_status}
          </Badge>
          <MoneyAmount
            amountRwf={transaction.direction === "out" ? -transaction.amount_rwf : transaction.amount_rwf}
            size="sm"
          />
        </div>
      </div>

      <p className="text-sm text-text-secondary">
        {displayCategory ?? "Uncategorized"}
        {transaction.category_confidence !== null &&
          ` · ${Math.round(transaction.category_confidence * 100)}% confidence`}
      </p>

      {!correcting && (
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            disabled={isPending}
            onClick={handleConfirm}
            className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setCorrecting(true)}
            className="min-h-9 text-xs font-medium text-text-muted disabled:opacity-50"
          >
            Correct
          </button>
          {canDismiss && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleDismiss}
              className="min-h-9 text-xs font-medium text-text-muted disabled:opacity-50"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {correcting && (
        <form onSubmit={handleCorrect} className="flex flex-col gap-2 pt-1">
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category"
            required
            className="min-h-9 rounded-control border border-border-strong bg-background px-2 text-xs text-text-primary"
          />
          <input
            type="text"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            placeholder="Subcategory (optional)"
            className="min-h-9 rounded-control border border-border-strong bg-background px-2 text-xs text-text-primary"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setCorrecting(false)}
              className="min-h-9 text-xs font-medium text-text-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">{errorMessage}</p>
      )}
    </div>
  );
}
