export const FINANCIAL_INBOX_KINDS = [
  "connector_health",
  "reconciliation_conflict",
  "duplicate_candidate",
  "needs_attribution",
  "category_review",
  "rule_suggestion",
  "budget_alert",
] as const;

export type FinancialInboxKind = (typeof FINANCIAL_INBOX_KINDS)[number];
export type FinancialInboxPriority = "critical" | "high" | "normal";

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
 * Canonical ordering and summary for every source queue. Severity is the
 * primary key; older work comes first within a severity so items cannot be
 * starved by a stream of newer arrivals. Kind and id are stable tie-breakers.
 */
export function buildFinancialInbox(
  sourceItems: readonly FinancialInboxItem[],
): FinancialInbox {
  const items = [...sourceItems].sort((a, b) => {
    const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priority !== 0) return priority;

    const aTime = a.actionableSince ?? "9999-12-31T23:59:59.999Z";
    const bTime = b.actionableSince ?? "9999-12-31T23:59:59.999Z";
    return aTime.localeCompare(bTime) ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id);
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
