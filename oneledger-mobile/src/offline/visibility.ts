import type { SqlDb } from "./sql";
import { applyServerPage, markPullComplete, type ServerTransaction } from "./local-store";
import { TransportError } from "./retry";

export const SHARED_LEASE_MS = 7 * 24 * 60 * 60_000;
export type SnapshotPage = { rows: ServerTransaction[]; workspaces: { id: string; kind: string }[]; server_time: string };
export async function assertCachedAccess(db: SqlDb, workspaceId: string, nowMs = Date.now()): Promise<void> {
  const lease = await db.get<{ kind: string; checked_at: string; expires_at: string }>(
    "SELECT kind, checked_at, expires_at FROM workspace_leases WHERE workspace_id = ?", [workspaceId]);
  if (!lease || !["personal", "household", "organization"].includes(lease.kind)
    || !Number.isFinite(Date.parse(lease.checked_at)) || !Number.isFinite(Date.parse(lease.expires_at))
    || (lease.kind !== "personal" && (nowMs < Date.parse(lease.checked_at) || nowMs >= Date.parse(lease.expires_at)))) {
    throw new Error("Reconnect to OneLedger to check access to this Space. Your pending changes have been kept.");
  }
}

/** A completed, validated snapshot is the only lease renewal. Partial or capped
 * downloads never renew access. Synced deletions are evicted; pending work is
 * kept but cannot be read through an expired/revoked workspace lease. */
export async function reconcileVisibility(input: {
  db: SqlDb;
  fetchPage(afterId: string | null): Promise<SnapshotPage>;
  visibleIds(ids: string[]): Promise<string[]>;
  active(): boolean;
  maxPages?: number;
}): Promise<number> {
  const { db } = input;
  const guard = () => { if (!input.active()) throw new TransportError("auth", "session_changed"); };
  guard();
  await db.run("DELETE FROM snapshot_seen");
  let after: string | null = null;
  let firstTime: string | null = null;
  let last: SnapshotPage | null = null;
  let count = 0;
  let exhausted = false;
  for (let page = 0; page < (input.maxPages ?? 5000); page++) {
    guard();
    const next = await input.fetchPage(after);
    guard();
    if (!Number.isFinite(Date.parse(next.server_time))) throw new Error("invalid_snapshot_time");
    firstTime ??= next.server_time;
    last = next;
    if (next.rows.length === 0) { exhausted = true; break; }
    const lastId = next.rows[next.rows.length - 1].id;
    if (after !== null && lastId <= after) throw new Error("snapshot_cursor_not_advancing");
    await applyServerPage(db, "transactions", next.rows, next.server_time, { advanceCursor: false });
    await db.transaction(async (tx) => {
      for (const row of next.rows) await tx.run("INSERT OR IGNORE INTO snapshot_seen(id) VALUES (?)", [row.id]);
    });
    after = lastId;
    count += next.rows.length;
  }
  if (!exhausted || !last || !firstTime) throw new Error("snapshot_incomplete");
  // Revalidate even rows delivered before a mid-download revoke. The server
  // does this under fresh RLS, never via a client-supplied permission list.
  const seen = await db.all<{ id: string }>("SELECT id FROM snapshot_seen ORDER BY id");
  for (let offset = 0; offset < seen.length; offset += 500) {
    guard();
    const batch = seen.slice(offset, offset + 500).map((r) => r.id);
    const visible = new Set(await input.visibleIds(batch));
    guard();
    await db.transaction(async (tx) => {
      for (const id of batch) if (!visible.has(id)) await tx.run("DELETE FROM snapshot_seen WHERE id = ?", [id]);
    });
  }
  guard();
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM wallet_snapshots WHERE id NOT IN (SELECT id FROM accounts)");
    await tx.run("DELETE FROM workspace_leases");
    for (const ws of last!.workspaces) {
      await tx.run("INSERT INTO workspace_leases VALUES (?, ?, ?, ?)", [ws.id, ws.kind, firstTime!, new Date(Date.parse(firstTime!) + SHARED_LEASE_MS).toISOString()]);
    }
    await tx.run("UPDATE transactions SET visibility_revoked = 1 WHERE sync_state <> 'synced' AND server_updated_at IS NOT NULL AND id NOT IN (SELECT id FROM snapshot_seen)");
    await tx.run("UPDATE transactions SET visibility_revoked = 0 WHERE id IN (SELECT id FROM snapshot_seen)");
    await tx.run("DELETE FROM transactions WHERE sync_state = 'synced' AND (id NOT IN (SELECT id FROM snapshot_seen) OR workspace_id NOT IN (SELECT workspace_id FROM workspace_leases))");
  });
  await markPullComplete(db, "transactions", last.server_time);
  return count;
}
