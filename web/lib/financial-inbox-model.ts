export const FINANCIAL_INBOX_KINDS = [
  "connector_health",
  "reconciliation_conflict",
  "duplicate_candidate",
  "needs_attribution",
  "category_review",
  "import_review",
  "sync_conflict",
  "rule_suggestion",
  "budget_alert",
  "bill_review",
] as const;

export type FinancialInboxKind = (typeof FINANCIAL_INBOX_KINDS)[number];
export type FinancialInboxPriority = "critical" | "high" | "normal";

/**
 * A lightweight inline action the Inbox may offer on an item. The Inbox
 * stays a read/projection layer: every one of these dispatches the
 * *authoritative* domain server action / RPC (which re-checks capability,
 * scope and idempotency) - it never writes workflow state itself. The
 * client component (components/InboxList.tsx) knows how to run each.
 */
export type InboxInlineAction =
  | { type: "confirm_category"; label: string; transactionId: string }
  | { type: "dismiss_category"; label: string; transactionId: string }
  | { type: "assign_to_me"; label: string; transactionId: string }
  | { type: "dismiss_rule"; label: string; suggestionKey: string }
  | {
    type: "accept_rule";
    label: string;
    suggestionKey: string;
    counterpartyName: string;
    category: string;
    subcategory: string | null;
  }
  | {
    type: "merge_duplicate";
    label: string;
    duplicateId: string;
    canonicalId: string;
  }
  | { type: "dismiss_duplicate"; label: string; transactionId: string }
  | { type: "apply_reconciliation"; label: string; reconciliationId: string }
  | { type: "reject_reconciliation"; label: string; reconciliationId: string };

export type FinancialInboxItem = {
  id: string;
  kind: FinancialInboxKind;
  priority: FinancialInboxPriority;
  title: string;
  description: string;
  href: string;
  /** The source event time. Older work wins inside the same priority. */
  actionableSince: string | null;
  /** Number of underlying records represented by this workflow item. */
  affectedCount: number;
  /**
   * The money at stake, in minor units, when it is meaningful (a payment
   * to reconcile, a duplicate's amount, a transaction to attribute).
   * Used only as a deterministic tie-break after severity and age.
   */
  financialImpactMinor?: number;
  /** Optional inline actions - primary first. Empty/absent = drill-in only. */
  actions?: InboxInlineAction[];
};

export type FinancialInbox = {
  items: FinancialInboxItem[];
  total: number;
  criticalCount: number;
  highCount: number;
  countsByKind: Record<FinancialInboxKind, number>;
};

const PRIORITY_RANK: Record<FinancialInboxPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
};

/**
 * Canonical ordering and summary for every source queue. Deterministic,
 * factor order fixed (assessment section 35):
 *   1. severity     - critical before high before normal
 *   2. age          - older work first, so nothing is starved by newer arrivals
 *   3. money at stake - larger financial impact first, as a tie-break only
 *   4. kind, then id - stable final tie-breaks
 * No arbitrary or model-ranked ordering.
 */
export function buildFinancialInbox(
  sourceItems: readonly FinancialInboxItem[],
): FinancialInbox {
  const items = [...sourceItems].sort((a, b) => {
    const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priority !== 0) return priority;

    const aTime = a.actionableSince ?? "9999-12-31T23:59:59.999Z";
    const bTime = b.actionableSince ?? "9999-12-31T23:59:59.999Z";
    const byAge = aTime.localeCompare(bTime);
    if (byAge !== 0) return byAge;

    const byImpact = (b.financialImpactMinor ?? 0) - (a.financialImpactMinor ?? 0);
    if (byImpact !== 0) return byImpact;

    return a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
  });

  const countsByKind = Object.fromEntries(
    FINANCIAL_INBOX_KINDS.map((kind) => [kind, 0]),
  ) as Record<FinancialInboxKind, number>;
  for (const item of items) countsByKind[item.kind] += 1;

  return {
    items,
    total: items.length,
    criticalCount: items.filter((item) => item.priority === "critical").length,
    highCount: items.filter((item) => item.priority === "high").length,
    countsByKind,
  };
}
