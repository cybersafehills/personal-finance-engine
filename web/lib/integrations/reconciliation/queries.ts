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
import { supabaseSession } from "../../supabase-session-server";
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
 * Balance-drift snapshot from `balance_reconciliations` (populated by the
 * P3-PR2 `reconcile-balances` job; RLS scopes rows to the caller's
 * workspace accounts). Open = `mismatch` (the running balance disagrees
 * with a reported one) or `pending_review` (an earlier unresolved pending
 * transaction makes the checkpoint provisional). A hard `mismatch` is the
 * urgent subset. `reconciled` / `insufficient_data` are not surfaced.
 *
 * Reports `available: false` only when the read itself fails (e.g. the
 * migration granting SELECT has not been applied) - an empty result is a
 * legitimate "all clear", not "coming soon".
 */
export async function getBalanceMismatchSnapshot(): Promise<ReconSectionInput> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("balance_reconciliations")
    .select("status, created_at")
    .in("status", ["mismatch", "pending_review"])
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("getBalanceMismatchSnapshot failed:", error.message);
    return { key: "balance", openCount: 0, available: false };
  }

  const rows = (data ?? []) as { status: string; created_at: string }[];
  return {
    key: "balance",
    openCount: rows.length,
    criticalCount: rows.filter((r) => r.status === "mismatch").length,
    oldestActionableAt: rows[0]?.created_at ?? null,
    available: true,
  };
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
