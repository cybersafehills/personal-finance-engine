"use client";

import { useState, useTransition } from "react";
import { formatDateTime } from "../lib/format";
import {
  applyHistoricalBatch,
  type PreviewResult,
  revertBulkCategorization,
} from "../app/categories/rules/[id]/apply/actions";

export function ApplyPolicyPanel(
  { policyId, initialPreview }: { policyId: string; initialPreview: PreviewResult },
) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [appliedTotal, setAppliedTotal] = useState(0);
  const [bulkOperationId, setBulkOperationId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [reverted, setReverted] = useState(false);

  if (!initialPreview.ok) {
    return <p role="alert" className="text-sm text-attention">{initialPreview.error}</p>;
  }

  if (initialPreview.matchCount === 0) {
    return (
      <p className="text-sm text-text-muted">
        No existing Uncategorized transactions match this rule right now.
      </p>
    );
  }

  function runApply() {
    setErrorMessage(null);
    const runId = crypto.randomUUID();
    setBulkOperationId(runId);
    startTransition(async () => {
      let total = 0;
      while (true) {
        const result = await applyHistoricalBatch(policyId, runId);
        if (!result.ok) {
          setErrorMessage(result.error);
          return;
        }
        total += result.appliedCount;
        setAppliedTotal(total);
        if (result.appliedCount === 0) break;
      }
      setDone(true);
    });
  }

  function runRevert() {
    if (!bulkOperationId) return;
    setErrorMessage(null);
    startTransition(async () => {
      const result = await revertBulkCategorization(bulkOperationId);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setReverted(true);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border-subtle bg-surface p-4">
        <p className="text-sm font-medium text-text-primary">
          {initialPreview.matchCount} matching transaction{initialPreview.matchCount === 1 ? "" : "s"}
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {initialPreview.sample.map((t) => (
            <li key={t.id} className="text-xs text-text-muted">
              {t.counterparty_name ?? "Unknown"} · {t.amount_rwf.toLocaleString()} RWF ·{" "}
              {formatDateTime(t.occurred_at)}
            </li>
          ))}
        </ul>
        {initialPreview.matchCount > initialPreview.sample.length && (
          <p className="mt-1 text-xs text-text-muted">
            …and {initialPreview.matchCount - initialPreview.sample.length} more.
          </p>
        )}
      </div>

      {!done && (
        <button
          type="button"
          disabled={isPending}
          onClick={runApply}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? `Applying… (${appliedTotal} so far)` : "Apply to matching transactions"}
        </button>
      )}

      {done && !reverted && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-secondary">Applied to {appliedTotal} transactions.</p>
          <button
            type="button"
            disabled={isPending}
            onClick={runRevert}
            className="min-h-11 self-start rounded-control px-2 text-sm font-medium text-attention disabled:opacity-50"
          >
            Revert this batch
          </button>
        </div>
      )}

      {reverted && <p className="text-sm text-text-secondary">Batch reverted.</p>}

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">{errorMessage}</p>
      )}
    </div>
  );
}
