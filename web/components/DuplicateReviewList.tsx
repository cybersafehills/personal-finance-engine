"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  dismissPossibleDuplicate,
  mergeDuplicateTransaction,
  type SimpleActionResult,
} from "../app/transactions/review/actions";
import { formatDateTime, formatRwf } from "../lib/format";
import { Badge } from "./Badge";
import type { DuplicateReviewCluster, DuplicateReviewTxn } from "../lib/queries";

function amountLabel(txn: DuplicateReviewTxn): string {
  const magnitude = txn.currency === "RWF"
    ? formatRwf(txn.amountMinor)
    : `${txn.currency} ${txn.amountMinor.toLocaleString()}`;
  return `${txn.direction === "out" ? "−" : ""}${magnitude}`;
}

function sourceLabel(source: string): string {
  switch (source) {
    case "mtn_momo":
      return "MTN MoMo";
    case "manual":
      return "Manual entry";
    default:
      return source;
  }
}

function DuplicateCluster({ cluster }: { cluster: DuplicateReviewCluster }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Oldest first - the earliest-seen transaction is the natural "original".
  const ordered = useMemo(
    () =>
      [...cluster.transactions].sort((a, b) =>
        a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0
      ),
    [cluster.transactions],
  );

  const [originalId, setOriginalId] = useState(
    () => ordered[0]?.transactionId ?? "",
  );

  const unresolved = ordered.filter(
    (t) => t.dedupeState === "possible_duplicate",
  );
  const headline = ordered[0];

  const run = (fn: () => Promise<SimpleActionResult>) => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-text-primary">
          {headline?.counterparty ?? "Transaction"}
        </span>
        <span className="text-sm font-medium text-text-primary">
          {headline ? amountLabel(headline) : null}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-text-muted">
        {ordered.length} transactions look like the same payment
        {unresolved.length === 0 ? " — all resolved" : ""}
      </p>

      <fieldset className="mt-3 flex flex-col gap-2">
        <legend className="sr-only">Choose the original transaction</legend>
        {ordered.map((txn) => {
          const isOriginal = txn.transactionId === originalId;
          const canAct = txn.dedupeState === "possible_duplicate" && !isOriginal;
          return (
            <div
              key={txn.transactionId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-border-subtle bg-background p-3"
            >
              <label className="flex min-w-0 flex-1 items-start gap-2">
                <input
                  type="radio"
                  name={`original-${cluster.fingerprint}`}
                  className="mt-1"
                  checked={isOriginal}
                  disabled={isPending}
                  onChange={() => setOriginalId(txn.transactionId)}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-text-primary">
                    {formatDateTime(txn.occurredAt)}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {sourceLabel(txn.source)}
                    {txn.category ? ` · ${txn.category}` : ""}
                  </span>
                </span>
              </label>

              <div className="flex shrink-0 items-center gap-2">
                {isOriginal ? (
                  <Badge variant="accent">Original</Badge>
                ) : txn.dedupeState === "possible_duplicate" ? (
                  <Badge variant="attention">Possible duplicate</Badge>
                ) : (
                  <Badge variant="neutral">Not a duplicate</Badge>
                )}
              </div>

              {canAct && (
                <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                  <button
                    type="button"
                    disabled={isPending || !originalId}
                    onClick={() =>
                      run(() =>
                        mergeDuplicateTransaction(txn.transactionId, originalId)
                      )}
                    className="min-h-8 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
                  >
                    Merge into original
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      run(() => dismissPossibleDuplicate(txn.transactionId))}
                    className="min-h-8 rounded-control border border-border-subtle px-3 text-xs font-medium text-text-secondary disabled:opacity-50"
                  >
                    Not a duplicate
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </fieldset>

      {errorMessage && (
        <p className="mt-2 text-xs text-attention" role="alert">
          {errorMessage}
        </p>
      )}
    </li>
  );
}

export function DuplicateReviewList({
  clusters,
}: {
  clusters: DuplicateReviewCluster[];
}) {
  return (
    <ul className="flex flex-col gap-3">
      {clusters.map((cluster) => (
        <DuplicateCluster key={cluster.fingerprint} cluster={cluster} />
      ))}
    </ul>
  );
}
