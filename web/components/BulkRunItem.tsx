"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revertBulkCategorization } from "../app/categories/rules/[id]/apply/actions";
import { formatDateTime } from "../lib/format";
import type { BulkCategorizationRun } from "../lib/queries";

export function BulkRunItem({ run }: { run: BulkCategorizationRun }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleRevert() {
    setErrorMessage(null);
    startTransition(async () => {
      const outcome = await revertBulkCategorization(run.bulkOperationId);
      if (!outcome.ok) {
        setErrorMessage(outcome.error);
        return;
      }
      setResult(`Reverted ${outcome.revertedCount} of ${run.rowCount} transactions.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <p className="text-sm font-medium text-text-primary">{run.policyName ?? "Unknown rule"}</p>
      <p className="text-xs text-text-muted">
        {formatDateTime(run.appliedAt)} · {run.rowCount} transaction{run.rowCount === 1 ? "" : "s"}
      </p>

      {result
        ? <p className="text-xs text-text-secondary">{result}</p>
        : (
          <button
            type="button"
            disabled={isPending}
            onClick={handleRevert}
            className="min-h-9 self-start rounded-control px-2 text-xs font-medium text-attention disabled:opacity-50"
          >
            Revert this run
          </button>
        )}

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">{errorMessage}</p>
      )}
    </div>
  );
}
