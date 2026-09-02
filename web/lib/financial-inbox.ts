import "server-only";

import {
  getActiveWorkspaceId,
  getCanonicalConnectorInstallations,
  getDashboardBudgetSummary,
  getLearnedPolicySuggestions,
  getNeedsAttributionTransactions,
  getReviewQueueTransactions,
  getSpaceDuplicateReview,
} from "./queries";
import { isPaymentIntentSurfaceEnabled } from "./pay/gate";
import { getReconciliationQueue } from "./pay/intents";
import {
  buildFinancialInbox,
  type FinancialInbox,
  type FinancialInboxItem,
} from "./financial-inbox-model";

const CONNECTOR_SETUP_GRACE_MS = 24 * 60 * 60 * 1000;

function amountLabel(amountMinor: number, currency = "RWF"): string {
  return `${new Intl.NumberFormat("en-RW").format(amountMinor)} ${currency}`;
}

/**
 * Authenticated, RLS-scoped read model for every currently actionable money
 * workflow. Source systems remain authoritative; this projection performs no
 * writes and links each item back to its existing resolution surface.
 */
export async function getFinancialInbox(): Promise<FinancialInbox> {
  const workspaceId = await getActiveWorkspaceId();
  const paymentEnabled = isPaymentIntentSurfaceEnabled(workspaceId);

  const [
    categoryReview,
    attribution,
    duplicateClusters,
    installations,
    learnedSuggestions,
    budgetSummary,
    reconciliation,
  ] = await Promise.all([
    getReviewQueueTransactions(),
    getNeedsAttributionTransactions(),
    getSpaceDuplicateReview(),
    getCanonicalConnectorInstallations(),
    getLearnedPolicySuggestions(),
    getDashboardBudgetSummary(),
    paymentEnabled
      ? getReconciliationQueue()
      : Promise.resolve({ candidates: [], requiresReconciliation: [] }),
  ]);

  const items: FinancialInboxItem[] = [];
  const transactionIdsWithHigherPriorityWork = new Set(attribution.map((row) => row.id));

  for (const cluster of duplicateClusters) {
    for (const transaction of cluster.transactions) {
      transactionIdsWithHigherPriorityWork.add(transaction.transactionId);
    }
    const first = [...cluster.transactions].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt)
    )[0];
    items.push({
      id: `duplicate:${cluster.fingerprint}`,
      kind: "duplicate_candidate",
      priority: "high",
      title: "Possible duplicate transactions",
      description: first
        ? `${cluster.transactions.length} records around ${amountLabel(first.amountMinor, first.currency)} need one keep-or-merge decision.`
        : "A possible duplicate cluster needs review.",
      href: "/transactions/review",
      actionableSince: first?.createdAt ?? first?.occurredAt ?? null,
      affectedCount: cluster.transactions.length,
    });
  }

  for (const row of attribution) {
    items.push({
      id: `attribution:${row.id}`,
      kind: "needs_attribution",
      priority: "high",
      title: row.counterpartyName ?? "Transaction needs attribution",
      description: `${amountLabel(row.amountRwf)}${row.workspaceName ? ` in ${row.workspaceName}` : ""} needs an owner or split.`,
      href: `/transactions/${row.id}`,
      actionableSince: row.occurredAt,
      affectedCount: 1,
    });
  }

  for (const row of categoryReview) {
    if (transactionIdsWithHigherPriorityWork.has(row.id)) continue;
    const conflict = row.category_decision_status === "conflict";
    items.push({
      id: `category:${row.id}`,
      kind: "category_review",
      priority: conflict ? "high" : "normal",
      title: row.counterparty_name ?? "Review transaction category",
      description: conflict
        ? "Conflicting category signals need a decision."
        : `${row.suggested_category ?? row.category ?? "A category"} is waiting for confirmation.`,
      href: `/transactions/${row.id}`,
      actionableSince: row.occurred_at,
      affectedCount: 1,
    });
  }

  for (const candidate of reconciliation.candidates) {
    const conflict = candidate.status === "conflict";
    items.push({
      id: `reconciliation:${candidate.id}`,
      kind: "reconciliation_conflict",
      priority: conflict ? "critical" : "high",
      title: conflict ? "Payment reconciliation conflict" : "Confirm payment match",
      description: `${candidate.intent.recipient_name ?? "Payment"} · ${amountLabel(candidate.intent.amount_minor, candidate.intent.currency)}`,
      href: "/pay/reconciliation",
      actionableSince: candidate.created_at,
      affectedCount: 1,
    });
  }

  for (const intent of reconciliation.requiresReconciliation) {
    items.push({
      id: `payment:${intent.id}`,
      kind: "reconciliation_conflict",
      priority: "critical",
      title: "Payment needs reconciliation",
      description: `${intent.recipient_name ?? "Payment"} · ${amountLabel(intent.amount_minor, intent.currency)}`,
      href: `/pay/${intent.id}`,
      actionableSince: intent.created_at,
      affectedCount: 1,
    });
  }

  const now = Date.now();
  for (const installation of installations) {
    if (!installation.canManage || installation.status === "revoked") continue;
    const waitingForFirstSuccess =
      (installation.status === "setup" || installation.status === "testing") &&
      installation.lastSuccessAt === null &&
      installation.lastAttemptAt !== null &&
      now - new Date(installation.lastAttemptAt).getTime() > CONNECTOR_SETUP_GRACE_MS;
    if (
      installation.status !== "error" &&
      installation.status !== "stale" &&
      !waitingForFirstSuccess
    ) continue;

    const isError = installation.status === "error";
    items.push({
      id: `connector:${installation.id}`,
      kind: "connector_health",
      priority: isError ? "critical" : "high",
      title: `${installation.displayName} connection ${isError ? "failed" : "needs attention"}`,
      description: isError && installation.lastErrorCode
        ? `Latest connector error: ${installation.lastErrorCode}.`
        : waitingForFirstSuccess
          ? "No successful data delivery was observed after setup."
          : "The connector has stopped delivering fresh data.",
      href: "/integrations/connections",
      actionableSince: installation.lastAttemptAt ?? installation.lastSuccessAt,
      affectedCount: 1,
    });
  }

  for (const suggestion of learnedSuggestions) {
    items.push({
      id: `rule:${suggestion.suggestionKey}`,
      kind: "rule_suggestion",
      priority: "normal",
      title: `Create a rule for ${suggestion.counterpartyName}`,
      description: `${suggestion.occurrenceCount} confirmed transactions consistently used ${suggestion.category}.`,
      href: "/categories/rules/suggestions",
      actionableSince: suggestion.lastOccurredAt,
      affectedCount: suggestion.occurrenceCount,
    });
  }

  if (budgetSummary && budgetSummary.actionableAlertCount > 0) {
    items.push({
      id: `budget:${budgetSummary.budgetId}`,
      kind: "budget_alert",
      priority: budgetSummary.worstStatus === "exceeded" ? "high" : "normal",
      title: `${budgetSummary.budgetName} needs attention`,
      description: `${budgetSummary.actionableAlertCount} budget ${budgetSummary.actionableAlertCount === 1 ? "category is" : "categories are"} at risk or exceeded.`,
      href: `/budgets/${budgetSummary.budgetId}`,
      actionableSince: null,
      affectedCount: budgetSummary.actionableAlertCount,
    });
  }

  return buildFinancialInbox(items);
}
