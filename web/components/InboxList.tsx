"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ActionRequiredItem } from "./ds/ActionRequiredItem";
import { EmptyState } from "./EmptyState";
import { formatDateTime } from "../lib/format";
import type {
  FinancialInboxItem,
  FinancialInboxKind,
  FinancialInboxPriority,
  InboxInlineAction,
} from "../lib/financial-inbox-model";
import {
  confirmTransactionCategory,
  dismissPossibleDuplicate,
  dismissSuggestedCategory,
  mergeDuplicateTransaction,
} from "../app/transactions/review/actions";
import { setTransactionAttribution } from "../app/transactions/[id]/actions";
import {
  acceptLearnedSuggestion,
  dismissLearnedSuggestion,
} from "../app/categories/rules/suggestions/actions";
import {
  applyReconciliation,
  rejectReconciliation,
} from "../app/pay/assisted-actions";

// The Financial Inbox's interactive layer. The Inbox stays a
// read/projection model (lib/financial-inbox.ts); this component only
// *dispatches* each item's authoritative domain server action - the one
// the drill-in surface already uses - and optimistically drops a resolved
// item from the list. Every action re-checks capability + scope + does its
// own idempotency server-side; a failure leaves the item in place with an
// inline error and the drill-in link still available.

const KIND_LABELS: Record<FinancialInboxKind, string> = {
  connector_health: "Connection",
  reconciliation_conflict: "Reconciliation",
  duplicate_candidate: "Duplicate",
  needs_attribution: "Attribution",
  category_review: "Category",
  import_review: "Import",
  sync_conflict: "Sync conflict",
  rule_suggestion: "Rule suggestion",
  budget_alert: "Budget",
  bill_review: "Bill",
};

const PRIORITY_LABELS: Record<FinancialInboxPriority, string> = {
  critical: "Resolve first",
  high: "Next up",
  normal: "When ready",
};

// Past this many same-kind items in one priority section, a full card per
// item is noise, not information (e.g. dozens of near-identical payment
// reconciliation conflicts, or every possible-duplicate cluster getting
// its own tile) - collapse into one summary card that links out to the
// domain's own review surface, where they're already properly grouped
// (DuplicateReviewList, /pay/reconciliation, etc). Only collapses a group
// whose items all drill into the exact same surface - if any item has its
// own distinct href (e.g. a specific transaction), grouping would hide
// that distinction, so it renders individually instead.
const GROUP_COLLAPSE_THRESHOLD = 4;

function partitionByKind(
  items: FinancialInboxItem[],
): FinancialInboxItem[][] {
  const order: FinancialInboxKind[] = [];
  const byKind = new Map<FinancialInboxKind, FinancialInboxItem[]>();
  for (const item of items) {
    if (!byKind.has(item.kind)) {
      byKind.set(item.kind, []);
      order.push(item.kind);
    }
    byKind.get(item.kind)!.push(item);
  }
  return order.map((kind) => byKind.get(kind)!);
}

type ActionResult = { ok: true } | { ok: false; error: string };

async function runInlineAction(
  action: InboxInlineAction,
  currentUserId: string | null,
): Promise<ActionResult> {
  switch (action.type) {
    case "confirm_category":
      return confirmTransactionCategory(action.transactionId);
    case "dismiss_category":
      return dismissSuggestedCategory(action.transactionId);
    case "assign_to_me":
      if (!currentUserId) {
        return { ok: false, error: "Could not identify you. Open the transaction." };
      }
      return setTransactionAttribution(
        action.transactionId,
        "member",
        currentUserId,
        [],
      );
    case "dismiss_rule":
      return dismissLearnedSuggestion(action.suggestionKey);
    case "accept_rule":
      return acceptLearnedSuggestion(
        action.suggestionKey,
        action.counterpartyName,
        action.category,
        action.subcategory,
      );
    case "merge_duplicate":
      return mergeDuplicateTransaction(action.duplicateId, action.canonicalId);
    case "dismiss_duplicate":
      return dismissPossibleDuplicate(action.transactionId);
    case "apply_reconciliation":
      return applyReconciliation(action.reconciliationId);
    case "reject_reconciliation":
      return rejectReconciliation(
        action.reconciliationId,
        "reviewed in inbox - not a match",
      );
  }
}

function InlineActions({
  item,
  currentUserId,
  onResolved,
}: {
  item: FinancialInboxItem;
  currentUserId: string | null;
  onResolved: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [runningType, setRunningType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!item.actions || item.actions.length === 0) return null;

  function run(action: InboxInlineAction) {
    setError(null);
    setRunningType(action.type);
    startTransition(async () => {
      const result = await runInlineAction(action, currentUserId);
      setRunningType(null);
      if (result.ok) onResolved(item.id);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {item.actions.map((action, i) => (
          <button
            key={action.type}
            type="button"
            disabled={pending}
            aria-busy={pending && runningType === action.type}
            onClick={() => run(action)}
            className={`min-h-9 rounded-control px-3 text-xs font-medium disabled:opacity-50 ${
              i === 0
                ? "bg-accent text-accent-foreground hover:opacity-95"
                : "border border-border-strong text-text-secondary hover:bg-background"
            }`}
          >
            {pending && runningType === action.type ? "Working…" : action.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-attention">
          {error}
        </p>
      )}
    </div>
  );
}

// One card standing in for many same-kind, same-surface items. Oldest
// item wins the "waiting since" (the item that's been sitting longest is
// the one worth calling out), most recent item wins the example
// description (what a reviewer would see first on the drill-in page).
function GroupSummaryItem({ items }: { items: FinancialInboxItem[] }) {
  const kind = items[0].kind;
  const href = items[0].href;
  const priority = items[0].priority;
  const oldest = items[0]; // already sorted oldest-first within a priority
  const mostRecent = items[items.length - 1];

  return (
    <ActionRequiredItem
      severity={priority}
      title={`${KIND_LABELS[kind]} (${items.length})`}
      description={`${items.length} items need review - most recent: ${mostRecent.description}`}
      href={href}
      sourceLabel={KIND_LABELS[kind]}
      timestamp={
        oldest.actionableSince
          ? `oldest waiting since ${formatDateTime(oldest.actionableSince)}`
          : undefined
      }
      action={
        <Link
          href={href}
          className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium leading-9 text-accent-foreground hover:opacity-95"
        >
          Review all {items.length}
        </Link>
      }
    />
  );
}

export function InboxList({
  items,
  currentUserId,
}: {
  items: FinancialInboxItem[];
  currentUserId: string | null;
}) {
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const onResolved = (id: string) =>
    setResolved((prev) => new Set(prev).add(id));

  const visible = items.filter((item) => !resolved.has(item.id));

  if (visible.length === 0) {
    return (
      <>
        <p aria-live="polite" className="sr-only">
          All inbox items resolved.
        </p>
        <EmptyState
          title="You’re all caught up"
          description="Review decisions, duplicate candidates, reconciliation conflicts, connector issues, and other actions will appear here."
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p aria-live="polite" className="sr-only">
        {resolved.size > 0
          ? `${resolved.size} item${resolved.size === 1 ? "" : "s"} resolved.`
          : ""}
      </p>
      {(["critical", "high", "normal"] as const).map((priority) => {
        const group = visible.filter((item) => item.priority === priority);
        if (group.length === 0) return null;
        const kindGroups = partitionByKind(group);
        return (
          <section key={priority} aria-labelledby={`inbox-${priority}`}>
            <h2
              id={`inbox-${priority}`}
              className="mb-2 text-sm font-semibold text-text-primary"
            >
              {PRIORITY_LABELS[priority]} ({group.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {kindGroups.map((kindItems) => {
                const sameHref = kindItems.every(
                  (item) => item.href === kindItems[0].href,
                );
                if (kindItems.length > GROUP_COLLAPSE_THRESHOLD && sameHref) {
                  return (
                    <GroupSummaryItem
                      key={`group:${priority}:${kindItems[0].kind}`}
                      items={kindItems}
                    />
                  );
                }
                return kindItems.map((item) => (
                  <ActionRequiredItem
                    key={item.id}
                    severity={item.priority}
                    title={item.title}
                    description={item.description}
                    href={item.href}
                    sourceLabel={KIND_LABELS[item.kind]}
                    timestamp={
                      item.actionableSince
                        ? `waiting since ${formatDateTime(item.actionableSince)}`
                        : undefined
                    }
                    affectedCount={item.affectedCount}
                    action={
                      <InlineActions
                        item={item}
                        currentUserId={currentUserId}
                        onResolved={onResolved}
                      />
                    }
                  />
                ));
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
