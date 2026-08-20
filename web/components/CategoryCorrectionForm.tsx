"use client";

import { useState, useTransition } from "react";
import { correctCategory } from "../app/categories/actions";

type Status = "idle" | "success" | "error";

export function CategoryCorrectionForm({
  transactionId,
  currentCategory,
  currentSubcategory,
  counterpartyName,
}: {
  transactionId: string;
  currentCategory: string | null;
  currentSubcategory: string | null;
  counterpartyName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(currentCategory ?? "");
  const [subcategory, setSubcategory] = useState(currentSubcategory ?? "");
  const [saveAsRule, setSaveAsRule] = useState(Boolean(counterpartyName));
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 min-h-11 rounded-control px-2 -mx-2 text-sm font-medium text-accent hover:underline"
      >
        Correct category
      </button>
    );
  }

  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-card border border-border-subtle bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setStatus("idle");
        setErrorMessage(null);
        startTransition(async () => {
          const result = await correctCategory(
            transactionId,
            category,
            subcategory || null,
            saveAsRule,
          );
          if (result.ok) {
            setStatus("success");
            setOpen(false);
          } else {
            setStatus("error");
            setErrorMessage(result.error);
          }
        });
      }}
    >
      <p className="text-xs text-text-muted">
        Changing:{" "}
        <span className="font-medium text-text-secondary">
          {currentCategory ?? "Uncategorized"}
        </span>{" "}
        → this transaction only. Amount, direction, fee, and the source
        message are never affected.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Category</span>
        <input
          type="text"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="e.g. Groceries"
          required
          className="min-h-11 rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">
          Subcategory (optional)
        </span>
        <input
          type="text"
          value={subcategory}
          onChange={(event) => setSubcategory(event.target.value)}
          className="min-h-11 rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </label>

      {counterpartyName && (
        <label className="flex items-start gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={saveAsRule}
            onChange={(event) => setSaveAsRule(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Also apply to future transactions from{" "}
            <span className="font-medium">{counterpartyName}</span>
          </span>
        </label>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save correction"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded-control px-2 text-sm font-medium text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>

      {status === "error" && (
        <p role="alert" className="text-sm text-attention">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
