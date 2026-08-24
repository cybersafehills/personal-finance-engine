"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmTransferLink, dismissTransferSuggestion } from "../app/transactions/transfers/actions";
import { formatMoney, isSupportedCurrency } from "../lib/money";
import { formatDateTime } from "../lib/format";
import type { TransferCandidateDisplay } from "../lib/queries";

export function TransferCandidateItem({ candidate }: { candidate: TransferCandidateDisplay }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  if (resolved || !isSupportedCurrency(candidate.currency)) return null;

  function handleConfirm() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await confirmTransferLink(candidate.outTransactionId, candidate.inTransactionId);
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
      const result = await dismissTransferSuggestion(candidate.outTransactionId, candidate.inTransactionId);
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
      <p className="text-sm text-text-secondary">
        <span className="font-medium text-text-primary">{candidate.outAccountName}</span> →{" "}
        <span className="font-medium text-text-primary">{candidate.inAccountName}</span>
      </p>
      <p className="text-sm text-text-primary">{formatMoney(BigInt(candidate.amountMinor), candidate.currency)}</p>
      <p className="text-xs text-text-muted">
        {formatDateTime(candidate.outOccurredAt)} → {formatDateTime(candidate.inOccurredAt)}
        {candidate.amountDiffPercent > 0 && ` · ${candidate.amountDiffPercent.toFixed(1)}% amount difference`}
      </p>

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">{errorMessage}</p>
      )}

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          disabled={isPending}
          onClick={handleConfirm}
          className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
        >
          Confirm transfer
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleDismiss}
          className="min-h-9 text-xs font-medium text-text-muted disabled:opacity-50"
        >
          Not a transfer
        </button>
      </div>
    </div>
  );
}
