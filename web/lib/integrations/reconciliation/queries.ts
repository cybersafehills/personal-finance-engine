import "server-only";

// Server-only assembler for the Reconciliation Center (Phase 3, P3-PR1).
//
// Reads the four existing "needs a human decision" queues through their
// existing RLS-scoped readers and hands a plain snapshot to the pure
// ./summary.ts engine. No writes; every resolution still happens on the
// queue's own surface.

import { getActiveWorkspaceId, getSpaceDuplicateReview } from "../../queries";
import { isPaymentIntentSurfaceEnabled } from "../../pay/gate";
import { getReconciliationQueue } from "../../pay/intents";
import { isWorkbooksEnabled } from "../gate";
import { listOpenConflicts } from "../queries";
import {
  buildReconciliationSummary,
  type ReconciliationSummary,
  type ReconSectionInput,
} from "./summary.ts";

function earliest(values: (string | null | undefined)[]): string | null {
  let min: string | null = null;
  for (const v of values) {
    if (!v) continue;
    if (min === null || v < min) min = v;
  }
  return min;
}

/**
 * Balance-drift snapshot. The `balance_reconciliations` table exists in
 * production but nothing populates it yet - the P3-PR2 edge function +
 * cron is what turns this section on. Until then it reports
 * `available: false`, which the Center renders as "coming soon" rather
 * than a misleading "all clear".
 */
export async function getBalanceMismatchSnapshot(): Promise<ReconSectionInput> {
  return { key: "balance", openCount: 0, criticalCount: 0, available: false };
}

async function getPaymentSnapshot(
  workspaceId: string | null,
): Promise<ReconSectionInput> {
  if (!isPaymentIntentSurfaceEnabled(workspaceId)) {
    return { key: "payments", openCount: 0, available: false };
  }
  const { candidates, requiresReconciliation } = await getReconciliationQueue();
  // A `conflict` candidate or an intent parked in `requires_reconciliation`
  // is urgent (the inbox flags both `critical`); a plain `linked` candidate
  // waiting to be applied is ordinary review work.
  const criticalCount =
    candidates.filter((c) => c.status === "conflict").length +
    requiresReconciliation.length;
  return {
    key: "payments",
    openCount: candidates.length + requiresReconciliation.length,
    criticalCount,
    oldestActionableAt: earliest([
      ...candidates.map((c) => c.created_at),
      ...requiresReconciliation.map((i) => i.created_at),
    ]),
    available: true,
  };
}

async function getDuplicateSnapshot(): Promise<ReconSectionInput> {
  const clusters = await getSpaceDuplicateReview();
  let openCount = 0;
  const timestamps: (string | null)[] = [];
  for (const cluster of clusters) {
    for (const txn of cluster.transactions) {
      if (txn.dedupeState !== "possible_duplicate") continue;
      openCount += 1;
      timestamps.push(txn.createdAt ?? txn.occurredAt ?? null);
    }
  }
  return {
    key: "duplicates",
    openCount,
    // Every possible-duplicate row is a real keep-or-merge decision.
    criticalCount: openCount,
    oldestActionableAt: earliest(timestamps),
    available: true,
  };
}

async function getSyncConflictSnapshot(
  workspaceId: string | null,
): Promise<ReconSectionInput> {
  if (!isWorkbooksEnabled(workspaceId)) {
    return { key: "sync_conflicts", openCount: 0, available: false };
  }
  const conflicts = await listOpenConflicts();
  return {
    key: "sync_conflicts",
    openCount: conflicts.length,
    // listOpenConflicts already returns oldest-first.
    oldestActionableAt: conflicts[0]?.createdAt ?? null,
    available: true,
  };
}

/** The whole Reconciliation Center model for the active workspace. */
export async function getReconciliationCenterSummary(): Promise<ReconciliationSummary> {
  const workspaceId = await getActiveWorkspaceId();
  const [balance, payments, duplicates, syncConflicts] = await Promise.all([
    getBalanceMismatchSnapshot(),
    getPaymentSnapshot(workspaceId),
    getDuplicateSnapshot(),
    getSyncConflictSnapshot(workspaceId),
  ]);
  return buildReconciliationSummary([
    balance,
    payments,
    duplicates,
    syncConflicts,
  ]);
}
