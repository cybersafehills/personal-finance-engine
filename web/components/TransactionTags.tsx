"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addTransactionTagAction,
  removeTransactionTagAction,
} from "../app/transactions/[id]/actions";

export function TransactionTags({
  transactionId,
  tags,
  suggestions = [],
}: {
  transactionId: string;
  tags: string[];
  suggestions?: string[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    const value = draft.trim();
    if (!value) return;
    setError(null);
    startTransition(async () => {
      const result = await addTransactionTagAction(transactionId, value);
      if (result.ok) {
        setDraft("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove(tag: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeTransactionTagAction(transactionId, tag);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  const unused = suggestions.filter((s) => !tags.includes(s)).slice(0, 8);

  return (
    <div className="mt-2 flex flex-col gap-2 text-sm">
      {tags.length > 0
        ? (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => remove(tag)}
                  disabled={pending}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border-subtle bg-background px-3 text-text-primary disabled:opacity-50"
                  aria-label={`Remove tag ${tag}`}
                >
                  {tag}
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )
        : <p className="text-text-muted">No tags yet.</p>}

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          list="transaction-tag-suggestions"
          placeholder="Add a tag (e.g. reimbursable)"
          maxLength={40}
          className="min-h-11 flex-1 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
        />
        <datalist id="transaction-tag-suggestions">
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
        <button
          type="button"
          onClick={add}
          disabled={pending || !draft.trim()}
          className="min-h-11 rounded-control border border-border-subtle bg-background px-4 font-medium text-text-primary disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          <span>Recent:</span>
          {unused.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await addTransactionTagAction(
                    transactionId,
                    s,
                  );
                  if (result.ok) router.refresh();
                  else setError(result.error);
                });
              }}
              disabled={pending}
              className="rounded-full border border-border-subtle px-2 py-0.5 text-text-secondary disabled:opacity-50"
            >
              + {s}
            </button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-attention">{error}</p>}
    </div>
  );
}
