import type { SqlDb } from "./sql";

// The durable outbox. Enqueue always happens inside the SAME transaction as the
// local financial write (see recordManualTransaction), so a crash can never
// leave a saved transaction with no queued upload, or an upload with no record.

export type OutboxState = "pending" | "in_flight" | "retry" | "rejected" | "stalled" | "conflict";

export type OutboxOp = {
  op_id: string;
  seq: number;
  entity_type: string;
  entity_id: string;
  op_type: string;
  payload: string;
  depends_on: string | null;
  state: OutboxState;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  created_at: string;
  conflict_data: string | null;
};

export async function enqueueOp(
  tx: SqlDb,
  op: {
    opId: string;
    entityType: string;
    entityId: string;
    opType: string;
    payload: unknown;
    dependsOn?: string | null;
    nowIso: string;
  },
): Promise<void> {
  await tx.run(
    `INSERT INTO outbox (op_id, seq, entity_type, entity_id, op_type, payload, depends_on, created_at)
     VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM outbox), ?, ?, ?, ?, ?, ?)`,
    [op.opId, op.entityType, op.entityId, op.opType, JSON.stringify(op.payload), op.dependsOn ?? null, op.nowIso],
  );
}

/** After a crash mid-upload nobody knows whether the server applied it; replay is safe (idempotent). */
export async function recoverInFlight(db: SqlDb): Promise<number> {
  const rows = await db.all<{ op_id: string; entity_id: string }>(
    "SELECT op_id, entity_id FROM outbox WHERE state = 'in_flight'",
  );
  if (rows.length === 0) return 0;
  await db.transaction(async (tx) => {
    await tx.run("UPDATE outbox SET state = 'pending', next_attempt_at = 0 WHERE state = 'in_flight'");
    for (const r of rows) {
      await tx.run("UPDATE transactions SET sync_state = 'pending' WHERE id = ? AND sync_state = 'syncing'", [
        r.entity_id,
      ]);
    }
  });
  return rows.length;
}

/** Oldest runnable op whose dependency (if any) has already been delivered. */
export function nextEligible(db: SqlDb, nowMs: number, ignoreBackoff: boolean): Promise<OutboxOp | null> {
  return db.get<OutboxOp>(
    `SELECT * FROM outbox o
     WHERE o.state IN ('pending','retry')
       AND (? = 1 OR o.next_attempt_at <= ?)
       AND (o.depends_on IS NULL OR NOT EXISTS (SELECT 1 FROM outbox d WHERE d.op_id = o.depends_on))
       -- Changes to one record are delivered in order: nothing jumps ahead of a
       -- refused or conflicted earlier change to the same record.
       AND NOT EXISTS (SELECT 1 FROM outbox p WHERE p.entity_id = o.entity_id AND p.seq < o.seq AND p.state IN ('rejected','stalled','conflict'))
     ORDER BY o.seq ASC LIMIT 1`,
    [ignoreBackoff ? 1 : 0, nowMs],
  );
}

export async function markInFlight(db: SqlDb, op: OutboxOp): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run("UPDATE outbox SET state = 'in_flight' WHERE op_id = ?", [op.op_id]);
    await tx.run("UPDATE transactions SET sync_state = 'syncing' WHERE id = ?", [op.entity_id]);
  });
}

/** Acknowledged (applied or replayed): the op leaves the outbox and the record is synced, atomically. */
export async function completeOp(db: SqlDb, op: OutboxOp, serverUpdatedAt: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM outbox WHERE op_id = ?", [op.op_id]);
    await tx.run(
      "UPDATE transactions SET sync_state = 'synced', sync_error = NULL, server_updated_at = COALESCE(?, server_updated_at) WHERE id = ?",
      [serverUpdatedAt, op.entity_id],
    );
  });
}

export async function scheduleRetry(
  db: SqlDb,
  op: OutboxOp,
  opts: { delayMs: number; nowMs: number; countAttempt: boolean; code: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run(
      "UPDATE outbox SET state = 'retry', attempts = attempts + ?, next_attempt_at = ?, last_error = ? WHERE op_id = ?",
      [opts.countAttempt ? 1 : 0, opts.nowMs + opts.delayMs, opts.code, op.op_id],
    );
    await tx.run("UPDATE transactions SET sync_state = 'pending', sync_error = ? WHERE id = ?", [opts.code, op.entity_id]);
  });
}

/** Stops automatic retries; the local record is kept and surfaced as needing attention. */
export async function holdOp(db: SqlDb, op: OutboxOp, state: "rejected" | "stalled", code: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run("UPDATE outbox SET state = ?, last_error = ?, attempts = attempts + 1 WHERE op_id = ?", [state, code, op.op_id]);
    await tx.run("UPDATE transactions SET sync_state = 'failed', sync_error = ? WHERE id = ?", [code, op.entity_id]);
  });
}

/** The server refused an edit because the field changed underneath it. Keeps the local proposal and the server's values. */
export async function holdConflict(db: SqlDb, op: OutboxOp, serverData: unknown): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run("UPDATE outbox SET state = 'conflict', conflict_data = ?, last_error = 'version_conflict' WHERE op_id = ?", [
      JSON.stringify(serverData ?? null),
      op.op_id,
    ]);
    await tx.run("UPDATE transactions SET sync_state = 'conflict', sync_error = 'version_conflict' WHERE id = ?", [op.entity_id]);
  });
}

/**
 * The user's decision on a conflicted edit. Nothing is discarded silently:
 *  keep_mine  re-sends the same change against the server's current values (force)
 *  use_server adopts the server's values locally and drops this edit (and later
 *             category edits to the same record, which were built on it)
 */
export async function resolveConflict(db: SqlDb, opId: string, choice: "keep_mine" | "use_server"): Promise<boolean> {
  const op = await db.get<OutboxOp>("SELECT * FROM outbox WHERE op_id = ? AND state = 'conflict'", [opId]);
  if (!op) return false;
  await db.transaction(async (tx) => {
    if (choice === "keep_mine") {
      const payload = JSON.parse(op.payload) as Record<string, unknown>;
      await tx.run("UPDATE outbox SET state = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL, conflict_data = NULL, payload = ? WHERE op_id = ?", [
        JSON.stringify({ ...payload, force: true }),
        opId,
      ]);
      await tx.run("UPDATE transactions SET sync_state = 'pending', sync_error = NULL WHERE id = ?", [op.entity_id]);
      return;
    }
    const server = JSON.parse(op.conflict_data ?? "null") as { category: string | null; subcategory: string | null; updated_at?: string } | null;
    await tx.run("DELETE FROM outbox WHERE entity_id = ? AND op_type = 'set_category' AND seq >= ?", [op.entity_id, op.seq]);
    if (server) {
      await tx.run(
        "UPDATE transactions SET category = ?, subcategory = ?, category_decision_status = 'confirmed', suggested_category = NULL WHERE id = ?",
        [server.category, server.subcategory, op.entity_id],
      );
    }
    const left = await tx.get<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ?", [op.entity_id]);
    await tx.run("UPDATE transactions SET sync_state = ?, sync_error = NULL WHERE id = ?", [(left?.n ?? 0) > 0 ? "pending" : "synced", op.entity_id]);
  });
  return true;
}

/** Auth expired mid-sync: no penalty, resume after sign-in. */
export async function releaseOp(db: SqlDb, op: OutboxOp): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run("UPDATE outbox SET state = 'pending' WHERE op_id = ?", [op.op_id]);
    await tx.run("UPDATE transactions SET sync_state = 'pending' WHERE id = ?", [op.entity_id]);
  });
}

/** User-initiated retry of held operations (and everything waiting on them). */
export async function retryHeld(db: SqlDb): Promise<number> {
  const rows = await db.all<{ op_id: string; entity_id: string }>(
    "SELECT op_id, entity_id FROM outbox WHERE state IN ('stalled','rejected')",
  );
  if (rows.length === 0) return 0;
  await db.transaction(async (tx) => {
    await tx.run("UPDATE outbox SET state = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL WHERE state IN ('stalled','rejected')");
    for (const r of rows) {
      await tx.run("UPDATE transactions SET sync_state = 'pending', sync_error = NULL WHERE id = ?", [r.entity_id]);
    }
  });
  return rows.length;
}

/**
 * Explicit user decision to drop a refused entry. Only ever offered for
 * rejected/stalled operations, never silently, and removes the local copy of a
 * record the server never accepted (nothing on the server is touched).
 */
export async function discardRejected(db: SqlDb, opId: string): Promise<boolean> {
  const op = await db.get<OutboxOp>("SELECT * FROM outbox WHERE op_id = ? AND state IN ('rejected','stalled')", [opId]);
  if (!op) return false;
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM outbox WHERE op_id = ?", [opId]);
    if (op.op_type === "set_category") {
      // An edit to a record the server already has: put back what this device
      // believed the server held; never delete the record itself.
      const p = JSON.parse(op.payload) as { base_category: string | null; base_subcategory: string | null };
      await tx.run("DELETE FROM outbox WHERE entity_id = ? AND op_type = 'set_category' AND seq > ?", [op.entity_id, op.seq]);
      await tx.run("UPDATE transactions SET category = ?, subcategory = ? WHERE id = ?", [p.base_category, p.base_subcategory, op.entity_id]);
      const left = await tx.get<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ?", [op.entity_id]);
      await tx.run("UPDATE transactions SET sync_state = ?, sync_error = NULL WHERE id = ?", [(left?.n ?? 0) > 0 ? "pending" : "synced", op.entity_id]);
      return;
    }
    // Anything that depended on it can never be delivered either.
    await tx.run("DELETE FROM outbox WHERE depends_on = ? OR (entity_id = ? AND seq > ?)", [opId, op.entity_id, op.seq]);
    // A record the server never accepted: remove the local copy (nothing on the server is touched).
    await tx.run("DELETE FROM transactions WHERE id = ? AND sync_state = 'failed'", [op.entity_id]);
  });
  return true;
}

export type OutboxSummary = {
  pending: number;
  inFlight: number;
  retrying: number;
  needsAttention: number;
  /** Edits the server refused because the record changed; each needs the user's choice. */
  conflicts: number;
};

export async function summarizeOutbox(db: SqlDb): Promise<OutboxSummary> {
  const rows = await db.all<{ state: OutboxState; n: number }>("SELECT state, COUNT(*) AS n FROM outbox GROUP BY state");
  const n = (s: OutboxState) => rows.find((r) => r.state === s)?.n ?? 0;
  return {
    pending: n("pending"),
    inFlight: n("in_flight"),
    retrying: n("retry"),
    needsAttention: n("rejected") + n("stalled"),
    conflicts: n("conflict"),
  };
}

export type OutboxEntry = {
  opId: string;
  state: OutboxState;
  attempts: number;
  lastError: string | null;
  amountRwf: number | null;
  currency?: string | null;
  direction: string | null;
  counterparty: string | null;
  occurredAt: string | null;
  opType: string;
  /** For a conflict: the change you made and what the server has now. */
  conflict: { mine: { category: string; subcategory: string | null }; server: { category: string | null; subcategory: string | null } } | null;
};

/** What the Sync details screen lists: one row per waiting or held change. */
export async function listOutboxEntries(db: SqlDb): Promise<OutboxEntry[]> {
  const rows = await db.all<{
    op_id: string; state: OutboxState; attempts: number; last_error: string | null;
    currency: string | null; readable_id: string | null; amount_rwf: number | null; direction: string | null; counterparty_name: string | null; occurred_at: string | null;
    op_type: string; payload: string; conflict_data: string | null;
  }>(
    `SELECT o.op_id, o.state, o.attempts, o.last_error, o.op_type, o.payload, o.conflict_data, t.id as readable_id, t.currency, t.amount_rwf, t.direction, t.counterparty_name, t.occurred_at
     FROM outbox o LEFT JOIN transactions t ON t.id = o.entity_id AND t.visibility_revoked = 0
       AND t.workspace_id IN (SELECT workspace_id FROM workspace_leases WHERE kind = 'personal' OR (checked_at <= ? AND expires_at > ?))
     ORDER BY o.seq ASC`, [new Date().toISOString(), new Date().toISOString()],
  );
  return rows.map((r) => ({
    opId: r.op_id, state: r.state, attempts: r.attempts, lastError: r.last_error,
    currency: r.currency, amountRwf: r.amount_rwf, direction: r.direction, counterparty: r.counterparty_name, occurredAt: r.occurred_at,
    opType: r.op_type,
    conflict:
      r.readable_id && r.state === "conflict" && r.conflict_data
        ? (() => {
            const p = JSON.parse(r.payload) as { category: string; subcategory: string | null };
            const sv = JSON.parse(r.conflict_data) as { category: string | null; subcategory: string | null };
            return { mine: { category: p.category, subcategory: p.subcategory }, server: { category: sv.category, subcategory: sv.subcategory } };
          })()
        : null,
  }));
}
