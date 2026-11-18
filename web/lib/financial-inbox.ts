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
import { kigaliDateKey } from "./kigali-time";
import { assessSilence } from "./silence";
import { supabaseSession } from "./supabase-session-server";
import { monthPeriodFor } from "./budget-period";
import { isPaymentIntentSurfaceEnabled } from "./pay/gate";
import { getReconciliationQueue } from "./pay/intents";
import { isIntegrationsEnabled, isWorkbooksEnabled } from "./integrations/gate";
import { isBillsEnabled } from "./bills/gate";
import { getBillDocuments, getBillPermissions } from "./bills/queries";
import {
  listImportBatchesNeedingReview,
  listOpenConflicts,
} from "./integrations/queries";
import {
  buildFinancialInbox,
  type FinancialInbox,
  type FinancialInboxItem,
} from "./financial-inbox-model";

const CONNECTOR_SETUP_GRACE_MS = 24 * 60 * 60 * 1000;
const ARRIVAL_LOOKBACK_DAYS = 60;
const ARRIVAL_READ_LIMIT = 2000;

/** Ingestion times of recent transactions per financial source: the rhythm of each phone. */
async function getArrivalsBySource(sourceIds: string[]): Promise<Map<string, string[]>> {
  const bySource = new Map<string, string[]>();
  if (sourceIds.length === 0) return bySource;
  const supabase = await supabaseSession();
  const since = new Date(Date.now() - ARRIVAL_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("transactions")
    .select("financial_source_id, created_at")
    .in("financial_source_id", sourceIds)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(ARRIVAL_READ_LIMIT);
  if (error) {
    // Without the rhythm the check falls back to its plain 48h minimum.
    console.error("getArrivalsBySource failed:", error.message);
    return bySource;
  }
  for (const r of data ?? []) {
    const id = r.financial_source_id as string | null;
    if (!id) continue;
    const list = bySource.get(id) ?? [];
    list.push(r.created_at as string);
    bySource.set(id, list);
  }
  return bySource;
}

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
  const integrationsEnabled = isIntegrationsEnabled(workspaceId);
  const workbooksEnabled = isWorkbooksEnabled(workspaceId);
  const billsEnabled = isBillsEnabled(workspaceId);

  const [
    categoryReview,
    attribution,
    duplicateClusters,
    installations,
    learnedSuggestions,
    budgetSummary,
    reconciliation,
    importReviewBatches,
    openConflicts,
    billDocs,
    billPermissions,
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
    integrationsEnabled
      ? listImportBatchesNeedingReview()
      : Promise.resolve([]),
    workbooksEnabled ? listOpenConflicts() : Promise.resolve([]),
    billsEnabled ? getBillDocuments({ status: "needs_review" }) : Promise.resolve([]),
    billsEnabled
      ? getBillPermissions(workspaceId)
      : Promise.resolve({
        canUpload: false,
        canReview: false,
        canApprove: false,
        canPost: false,
        canDownloadOriginal: false,
        canViewAudit: false,
        canManage: false,
      }),
  ]);

  const items: FinancialInboxItem[] = [];
  const transactionIdsWithHigherPriorityWork = new Set(attribution.map((row) => row.id));

  for (const cluster of duplicateClusters) {
    for (const transaction of cluster.transactions) {
      transactionIdsWithHigherPriorityWork.add(transaction.transactionId);
    }
    const ordered = [...cluster.transactions].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt)
    );
    const first = ordered[0];

    // A clean 2-row cluster - exactly one still-open possible_duplicate
    // plus one older keeper - can be resolved in one tap. Anything larger
    // or more ambiguous stays drill-in only (human review, never a guess).
    const possibleDup = cluster.transactions.filter(
      (t) => t.dedupeState === "possible_duplicate",
    );
    const keeper = ordered.find((t) => t.dedupeState !== "possible_duplicate");
    const cleanPair = cluster.transactions.length === 2 &&
      possibleDup.length === 1 && keeper != null;

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
      financialImpactMinor: first?.amountMinor,
      actions: cleanPair
        ? [
          {
            type: "merge_duplicate",
            label: "Merge",
            duplicateId: possibleDup[0].transactionId,
            canonicalId: keeper.transactionId,
          },
          {
            type: "dismiss_duplicate",
            label: "Not duplicates",
            transactionId: possibleDup[0].transactionId,
          },
        ]
        : undefined,
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
      financialImpactMinor: Math.abs(row.amountRwf),
      actions: [
        { type: "assign_to_me", label: "This was mine", transactionId: row.id },
      ],
    });
  }

  for (const row of categoryReview) {
    if (transactionIdsWithHigherPriorityWork.has(row.id)) continue;
    const conflict = row.category_decision_status === "conflict";
    const suggested = row.suggested_category ?? row.category ?? null;
    items.push({
      id: `category:${row.id}`,
      kind: "category_review",
      priority: conflict ? "high" : "normal",
      title: row.counterparty_name ?? "Review transaction category",
      description: conflict
        ? "Conflicting category signals need a decision."
        : `${suggested ?? "A category"} is waiting for confirmation.`,
      href: `/transactions/${row.id}`,
      actionableSince: row.occurred_at,
      affectedCount: 1,
      // A conflict needs a real choice (drill in); a plain suggestion can
      // be confirmed or waved off right here. Both call the same
      // review-queue RPCs the drill-in surface uses.
      actions: conflict ? undefined : [
        {
          type: "confirm_category",
          label: suggested ? `Confirm ${suggested}` : "Confirm category",
          transactionId: row.id,
        },
        { type: "dismiss_category", label: "Dismiss", transactionId: row.id },
      ],
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
      financialImpactMinor: candidate.intent.amount_minor,
      // A proposed (non-conflict) match is a yes/no decision; a conflict
      // needs the full drill-in.
      actions: conflict ? undefined : [
        {
          type: "apply_reconciliation",
          label: "Confirm match",
          reconciliationId: candidate.id,
        },
        {
          type: "reject_reconciliation",
          label: "Not a match",
          reconciliationId: candidate.id,
        },
      ],
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

  // A phone that has stopped sending means missing transactions, and nothing
  // else flags it (the connector status only changes on errors). Judged against
  // each wallet's own rhythm (lib/silence.ts), phones only, once per installation.
  const phoneInstallations = installations.filter((i) =>
    i.canManage && i.authMode === "device_secret" &&
    (i.status === "healthy" || i.status === "setup" || i.status === "testing")
  );
  const arrivals = await getArrivalsBySource(
    phoneInstallations.flatMap((i) => i.sources.map((src) => src.id)),
  );
  const flaggedQuiet = new Set<string>();
  for (const installation of phoneInstallations) {
    const lastSeen = [
      installation.lastSuccessAt,
      ...installation.credentials.filter((c) => c.status === "active").map((c) => c.lastUsedAt),
    ].filter((v): v is string => v !== null).sort().pop() ?? null;
    const res = assessSilence({
      lastSeenIso: lastSeen,
      arrivalsIso: installation.sources.flatMap((src) => arrivals.get(src.id) ?? []),
      nowMs: now,
    });
    if (!res.quiet || res.silentHours === null) continue;
    const days = Math.floor(res.silentHours / 24);
    // "My Phone" says nothing; the wallet it feeds says which money is affected.
    const walletNames = [
      ...new Set(installation.sources.flatMap((src) => src.accounts.map((a) => a.name))),
    ];
    const label = walletNames.length > 0 ? walletNames.join(" and ") : installation.displayName;
    flaggedQuiet.add(installation.id);
    items.push({
      id: `connector-quiet:${installation.id}`,
      kind: "connector_health",
      priority: "high",
      title: `${label} hasn't sent anything for ${days} day${days === 1 ? "" : "s"}`,
      description:
        "Transactions from this wallet may be missing until the phone sends again. Open the OneLedger shortcut on that phone, or reconnect it.",
      href: "/integrations/connections",
      actionableSince: lastSeen,
      affectedCount: 1,
    });
  }

  for (const installation of installations) {
    if (flaggedQuiet.has(installation.id)) continue;
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
      actions: [
        {
          type: "accept_rule",
          label: `Always ${suggestion.category}`,
          suggestionKey: suggestion.suggestionKey,
          counterpartyName: suggestion.counterpartyName,
          category: suggestion.category,
          subcategory: suggestion.subcategory,
        },
        {
          type: "dismiss_rule",
          label: "Dismiss",
          suggestionKey: suggestion.suggestionKey,
        },
      ],
    });
  }

  for (const batch of importReviewBatches) {
    const needsReview = Number(batch.rowCounts.needs_review ?? 0);
    const ready = Number(batch.rowCounts.ready ?? 0);
    items.push({
      id: `import:${batch.id}`,
      kind: "import_review",
      priority: needsReview > 0 ? "high" : "normal",
      title: `Finish importing ${batch.originalFilename}`,
      description: needsReview > 0
        ? `${needsReview} rows need review and ${ready} are ready to import.`
        : `${ready} rows are mapped and ready to import.`,
      href: `/integrations/imports/${batch.id}`,
      actionableSince: batch.createdAt,
      affectedCount: needsReview + ready,
    });
  }

  if (openConflicts.length > 0) {
    const oldest = openConflicts[0];
    items.push({
      id: `sync-conflict:${oldest.workspaceId}`,
      kind: "sync_conflict",
      priority: "high",
      title: "Sync conflicts need a decision",
      description:
        `${openConflicts.length} field ${openConflicts.length === 1 ? "difference" : "differences"} between OneLedger and a connected workbook.`,
      href: "/integrations/sync/conflicts",
      actionableSince: oldest.createdAt,
      affectedCount: openConflicts.length,
    });
  }

  // An active budget whose month is over: say so and point at the one-tap
  // fix, instead of "needs attention" about a month that can't be changed.
  if (budgetSummary?.ended) {
    const month = monthPeriodFor(kigaliDateKey(new Date().toISOString()));
    items.push({
      id: `budget-ended:${budgetSummary.budgetId}`,
      kind: "budget_alert",
      priority: "normal",
      title: `${budgetSummary.budgetName} has ended`,
      description: `It covered up to ${budgetSummary.periodEnd}. Start ${month.monthName}'s budget to keep tracking this month.`,
      href: "/budgets",
      actionableSince: `${budgetSummary.periodEnd}T00:00:00Z`,
      affectedCount: 1,
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

  // Bills (dark until BILLS_ENABLED). Only surfaced to a member who can
  // actually review one - the correction/approval flow is multi-step, so
  // this is a drill-in item, no inline action.
  if (billsEnabled && billPermissions.canReview) {
    for (const bill of billDocs) {
      items.push({
        id: `bill:${bill.id}`,
        kind: "bill_review",
        priority: "high",
        title: `Review ${bill.original_filename}`,
        description: "Extracted fields need a human check before this bill can be approved.",
        href: `/bills/${bill.id}`,
        actionableSince: bill.uploaded_at,
        affectedCount: 1,
      });
    }
  }

  return buildFinancialInbox(items);
}
