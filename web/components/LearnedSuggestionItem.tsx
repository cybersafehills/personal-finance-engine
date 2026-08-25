"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  acceptLearnedSuggestion,
  dismissLearnedSuggestion,
} from "../app/categories/rules/suggestions/actions";
import { formatDateTime, formatRwf } from "../lib/format";
import type { LearnedPolicySuggestion } from "../lib/queries";

export function LearnedSuggestionItem({ suggestion }: { suggestion: LearnedPolicySuggestion }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (resolved) return null;

  function handleAccept() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await acceptLearnedSuggestion(
        suggestion.suggestionKey,
        suggestion.counterpartyName,
        suggestion.category,
        suggestion.subcategory,
      );
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
      const result = await dismissLearnedSuggestion(suggestion.suggestionKey);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setResolved(true);
      router.refresh();
    });
  }

  const editHref = `/categories/rules/new?template=learned&name=${
    encodeURIComponent(suggestion.counterpartyName)
  }&category=${encodeURIComponent(suggestion.category)}&subcategory=${
    encodeURIComponent(suggestion.subcategory ?? "")
  }&pattern=${encodeURIComponent(suggestion.counterpartyName)}`;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <div>
        <p className="text-sm font-medium text-text-primary">{suggestion.counterpartyName}</p>
        <p className="text-sm text-text-muted">
          {suggestion.category}
          {suggestion.subcategory ? ` · ${suggestion.subcategory}` : ""}
        </p>
      </div>

      <p className="text-xs text-text-muted">
        Corrected {suggestion.occurrenceCount} times · last {formatDateTime(suggestion.lastOccurredAt)}
      </p>

      <ul className="flex flex-col gap-1">
        {suggestion.sample.map((t) => (
          <li key={t.id} className="text-xs text-text-muted">
            {formatRwf(t.amount_rwf)} · {formatDateTime(t.occurred_at)}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={isPending}
          onClick={handleAccept}
          className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
        >
          Accept
        </button>
        <Link href={editHref} className="text-xs font-medium text-text-muted hover:text-text-primary">
          Edit before accepting
        </Link>
        <button
          type="button"
          disabled={isPending}
          onClick={handleDismiss}
          className="text-xs font-medium text-text-muted disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">{errorMessage}</p>
      )}
    </div>
  );
}
