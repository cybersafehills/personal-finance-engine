import { reconcileVisibility, type SnapshotPage } from "./visibility";
import type { ManualAccount } from "@/features/manual/input";

import { applyServerPage, getCursor, markPullComplete, upsertAccounts, type ServerTransaction } from "./local-store";
import {
  completeOp,
  holdConflict,
  holdOp,
  markInFlight,
  nextEligible,
  recoverInFlight,
  releaseOp,
  scheduleRetry,
  type OutboxOp,
} from "./outbox";
import { backoffDelayMs, MAX_SERVER_ATTEMPTS, TransportError } from "./retry";
import type { SqlDb } from "./sql";

export const TX_STREAM = "transactions";
export const PAGE_SIZE = 200;
/** Re-read slightly before the cursor so a row committed late (older updated_at) is not missed. Upserts are idempotent. */
export const CURSOR_OVERLAP_MS = 2 * 60_000;
const MAX_PULL_PAGES = 500;

export interface SyncTransport {
  /** Throws TransportError. `replayed` means the server had already applied this op_id. */
  applyOp(op: OutboxOp): Promise<
    | { status: "applied" | "replayed"; serverUpdatedAt: string | null }
    | { status: "conflict"; server: unknown }
  >;
  fetchChanges(after: { updatedAt: string | null; id: string | null }, limit: number): Promise<ServerTransaction[]>;
  fetchAccounts(): Promise<ManualAccount[]>;
  fetchSnapshotPage?(afterId: string | null): Promise<SnapshotPage>;
  visibleIds?(ids: string[]): Promise<string[]>;
}

export type SyncReport = {
  pushed: number;
  replayed: number;
  rejected: number;
  conflicts: number;
  retrying: number;
  pulled: number;
  stoppedFor: "offline" | "auth" | "error" | null;
};

export type SyncDeps = {
  db: SqlDb;
  transport: SyncTransport;
  now?: () => number;
  random?: () => number;
  /** Ignore retry timers (used when connectivity has just returned or the user taps Retry). */
  ignoreBackoff?: boolean;
  isActive?: () => boolean;
};

const running = new WeakMap<SqlDb, Promise<SyncReport>>();
export function runSync(deps: SyncDeps): Promise<SyncReport> {
  const existing = running.get(deps.db);
  if (existing) return existing;
  const task = syncOnce(deps).finally(() => running.delete(deps.db));
  running.set(deps.db, task);
  return task;
}
export async function finishSync(db: SqlDb): Promise<void> { await running.get(db)?.catch(() => undefined); }

async function syncOnce(deps: SyncDeps): Promise<SyncReport> {
  const { db, transport } = deps;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const active = deps.isActive ?? (() => true);
  const guard = () => { if (!active()) throw new TransportError("auth", "session_changed"); };
  const report: SyncReport = { pushed: 0, replayed: 0, rejected: 0, conflicts: 0, retrying: 0, pulled: 0, stoppedFor: null };

  if (!active()) return { ...report, stoppedFor: "auth" };
  await recoverInFlight(db);

  // ---- Push: oldest first, dependencies respected, stop on offline/auth. ----
  for (;;) {
    if (!active()) return { ...report, stoppedFor: "auth" };
    const op = await nextEligible(db, now(), deps.ignoreBackoff === true);
    if (!op) break;
    await markInFlight(db, op);
    try {
      guard();
      const result = await transport.applyOp(op);
      guard();
      if (result.status === "conflict") {
        await holdConflict(db, op, result.server);
        report.conflicts += 1;
        continue;
      }
      await completeOp(db, op, result.serverUpdatedAt);
      report.pushed += 1;
      if (result.status === "replayed") report.replayed += 1;
    } catch (error) {
      const failure = error instanceof TransportError ? error : new TransportError("server", "server_error");
      if (failure.kind === "network") {
        // Not the operation's fault: no attempt is counted. Stop and wait for connectivity.
        await scheduleRetry(db, op, { delayMs: backoffDelayMs(op.attempts, random), nowMs: now(), countAttempt: false, code: failure.code });
        report.retrying += 1;
        report.stoppedFor = "offline";
        return report;
      }
      if (failure.kind === "auth") {
        await releaseOp(db, op);
        report.stoppedFor = "auth";
        return report;
      }
      if (failure.kind === "server") {
        if (op.attempts + 1 >= MAX_SERVER_ATTEMPTS) {
          await holdOp(db, op, "stalled", failure.code);
          report.rejected += 1;
        } else {
          await scheduleRetry(db, op, { delayMs: backoffDelayMs(op.attempts + 1, random), nowMs: now(), countAttempt: true, code: failure.code });
          report.retrying += 1;
        }
        continue;
      }
      // permanent | conflict: keep the record, stop auto-retrying, ask the user.
      await holdOp(db, op, "rejected", failure.code);
      report.rejected += 1;
    }
  }

  // ---- Pull: accounts, then incremental transaction changes. ----
  try {
    guard();
    const accounts = await transport.fetchAccounts();
    guard();
    await upsertAccounts(db, accounts);
    if (transport.fetchSnapshotPage && transport.visibleIds) {
      report.pulled = await reconcileVisibility({ db, fetchPage: transport.fetchSnapshotPage.bind(transport), visibleIds: transport.visibleIds.bind(transport), active });
      return report;
    }

    const cursor = await getCursor(db, TX_STREAM);
    let after = {
      updatedAt: cursor.updatedAt ? new Date(Date.parse(cursor.updatedAt) - CURSOR_OVERLAP_MS).toISOString() : null,
      id: null as string | null,
    };
    let exhausted = false;
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      guard();
      const rows = await transport.fetchChanges(after, PAGE_SIZE);
      guard();
      const nowIso = new Date(now()).toISOString();
      await applyServerPage(db, TX_STREAM, rows, nowIso, { advanceCursor: true });
      report.pulled += rows.length;
      if (rows.length < PAGE_SIZE) { exhausted = true; break; }
      const last = rows[rows.length - 1];
      after = { updatedAt: last.updated_at, id: last.id };
    }
    if (!exhausted) throw new Error("snapshot_incomplete");
    guard();
    await markPullComplete(db, TX_STREAM, new Date(now()).toISOString());
  } catch (error) {
    const failure = error instanceof TransportError ? error : null;
    report.stoppedFor = failure?.kind === "network" ? "offline" : failure?.kind === "auth" ? "auth" : "error";
  }
  return report;
}
