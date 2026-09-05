"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatSignedRwf } from "../lib/format";
import { markOnboardingMilestone } from "../app/onboarding/actions";
import { confirmTransactionCategory } from "../app/transactions/review/actions";

// Release 3 (First Run) moments (ADR 0012), shown on Home once the
// journey reaches them and hidden again once marked. Both mark their
// milestone via the authoritative RPC (idempotent server-side).

/**
 * The first-real-transaction review card (assessment section 30). Asks
 * one high-value question about the most recent transaction; either
 * answer counts as "reviewed one transaction" and stamps the milestone.
 */
export function FirstTransactionReviewCard({
  transactionId,
  counterparty,
  amountRwf,
  category,
}: {
  transactionId: string;
  counterparty: string | null;
  amountRwf: number;
  category: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmRight() {
    setError(null);
    startTransition(async () => {
      if (category) {
        const r = await confirmTransactionCategory(transactionId);
        if (!r.ok) {
          setError(r.error);
          return;
        }
      }
      await markOnboardingMilestone("first_review");
      router.refresh();
    });
  }

  function reviewElsewhere() {
    startTransition(async () => {
      await markOnboardingMilestone("first_review");
      router.push(`/transactions/${transactionId}`);
    });
  }

  return (
    <section
      aria-label="Review your first transaction"
      className="flex flex-col gap-3 rounded-card border border-accent/30 bg-background p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-text-primary">
          Your first transaction
        </h2>
        <p className="mt-0.5 text-sm text-text-muted">
          OneLedger sorted this into your ledger. Does it look right?
        </p>
      </div>

      <div className="rounded-control border border-border-subtle bg-surface p-3">
        <p className="text-sm font-medium text-text-primary">
          {counterparty ?? "Transaction"}
        </p>
        <p className="text-sm tabular-nums text-text-secondary">
          {formatSignedRwf(amountRwf)}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {category ? `Category: ${category}` : "Not categorized yet"}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-xs text-attention">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={confirmRight}
          className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
        >
          {pending ? "Saving…" : "Looks right"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={reviewElsewhere}
          className="min-h-9 rounded-control border border-border-strong px-3 text-xs font-medium text-text-secondary hover:bg-surface disabled:opacity-50"
        >
          Change category
        </button>
      </div>
    </section>
  );
}

/**
 * The first insight (assessment section 31). A single deterministic fact -
 * the biggest spending category so far - not a fabricated "score".
 * Acknowledging it stamps the milestone so it does not reappear.
 */
export function FirstInsightCard({
  topCategory,
  topCategoryTotalRwf,
}: {
  topCategory: string;
  topCategoryTotalRwf: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function acknowledge() {
    startTransition(async () => {
      await markOnboardingMilestone("first_insight");
      router.refresh();
    });
  }

  return (
    <section
      aria-label="Your first insight"
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-text-primary">
          Your first insight
        </h2>
        <p className="mt-1 text-sm text-text-primary">
          Your biggest spending category so far is{" "}
          <span className="font-semibold">{topCategory}</span> at{" "}
          <span className="tabular-nums">
            {formatSignedRwf(-Math.abs(topCategoryTotalRwf))}
          </span>
          .
        </p>
        <p className="mt-1 text-xs text-text-muted">
          As more activity arrives, OneLedger will surface changes and
          patterns worth knowing about.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={acknowledge}
          className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
        >
          {pending ? "…" : "Got it"}
        </button>
        <Link
          href="/categories"
          className="min-h-9 text-xs font-medium leading-9 text-accent hover:underline"
        >
          See all categories
        </Link>
      </div>
    </section>
  );
}
