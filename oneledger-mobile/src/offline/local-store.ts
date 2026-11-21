import type { ManualAccount, ManualTransactionArgs } from "@/features/manual/input";

import { enqueueOp } from "./outbox";
import type { SqlDb } from "./sql";

// Local financial repository. UI code calls these; it never touches the outbox
// or SQL itself.

export type SyncState = "local_only" | "pending" | "syncing" | "synced" | "conflict" | "failed";

/** A server transaction row as the sync feed delivers it. */
export type ServerTransaction = {
  id: string;
  account_id: string | null;
  workspace_id: string | null;
  source: string;
  transaction_type: string;
  direction: string;
  status: string;
  currency: string;
  amount_rwf: number;
  fee_rwf: number;
  principal_effect_rwf: number | null;
  fee_effect_rwf: number | null;
  settlement_state: string | null;
  balance_after_rwf: number | null;
  counterparty_name: string | null;
  counterparty_reference: string | null;
  occurred_at: string;
  category: string | null;
  subcategory: string | null;
  category_decision_status: string;
  suggested_category: string | null;
  dedupe_state: string;
  notes: string | null;
  updated_at: string;
};

export type LocalTransaction = Omit<ServerTransaction, "updated_at"> & {
  server_updated_at: string | null;
  sync_state: SyncState;
  sync_error: string | null;
};

/** One text form for every instant ("...T..:..:..sssZ") so ordering and range filters by string are correct. */
export function canonicalInstant(value: string): string {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

export const CREATE_MANUAL = "create_manual_transaction";

export type CreateManualPayload = ManualTransactionArgs & { transaction_id: string };

/**
 * Saves a manual transaction on the device and queues its upload in ONE atomic
 * transaction. Returns as soon as it is durable; nothing waits on the network.
 * The row is shown as pending, never as confirmed: the server decides that.
 */
export async function recordManualTransaction(
  db: SqlDb,
  input: { args: ManualTransactionArgs; account: ManualAccount; transactionId: string; opId: string; nowIso: string },
): Promise<string> {
  const { args, account, transactionId, opId, nowIso } = input;
  const out = args.p_direction === "out";
  const payload: CreateManualPayload = { ...args, transaction_id: transactionId };

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO transactions (
         id, account_id, workspace_id, source, transaction_type, direction, status, currency,
         amount_rwf, fee_rwf, principal_effect_rwf, fee_effect_rwf, settlement_state,
         counterparty_name, occurred_at, notes, category_decision_status, sync_state)
       VALUES (?, ?, ?, 'manual', ?, ?, 'success', ?, ?, ?, ?, ?, 'settled', ?, ?, ?, 'uncategorized', 'pending')`,
      [
        transactionId,
        account.id,
        account.workspaceId,
        args.p_transaction_type,
        args.p_direction,
        account.currency,
        args.p_amount_minor,
        args.p_fee_minor,
        out ? -args.p_amount_minor : args.p_amount_minor,
        out ? -args.p_fee_minor : 0,
        args.p_counterparty_name,
        canonicalInstant(args.p_occurred_at),
        args.p_notes,
      ],
    );
    await enqueueOp(tx, {
      opId,
      entityType: "transaction",
      entityId: transactionId,
      opType: CREATE_MANUAL,
      payload,
      nowIso,
    });
  });
  return transactionId;
}

const COLUMNS =
  "id, account_id, workspace_id, source, transaction_type, direction, status, currency, amount_rwf, fee_rwf, principal_effect_rwf, fee_effect_rwf, settlement_state, balance_after_rwf, counterparty_name, counterparty_reference, occurred_at, category, subcategory, category_decision_status, suggested_category, dedupe_state, notes, server_updated_at, sync_state, sync_error";

export async function listLocalTransactions(
  db: SqlDb,
  opts: { limit?: number; offset?: number; direction?: "in" | "out"; sinceIso?: string; needsReview?: boolean; q?: string; category?: string; workspaceId?: string } = {},
): Promise<LocalTransaction[]> {
  const where = ["dedupe_state <> 'merged'"];
  const params: (string | number)[] = [];
  if (opts.workspaceId) { where.push("workspace_id = ?"); params.push(opts.workspaceId); }
  if (opts.direction) {
    where.push("direction = ?");
    params.push(opts.direction);
  }
  if (opts.sinceIso) {
    where.push("occurred_at >= ?");
    params.push(opts.sinceIso);
  }
  if (opts.needsReview) where.push("category_decision_status IN ('provisional','suggested','conflict')");
  if (opts.category) {
    if (opts.category === "Uncategorized") where.push("category IS NULL");
    else {
      where.push("category = ?");
      params.push(opts.category);
    }
  }
  if (opts.q) {
    const like = `%${opts.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push("(counterparty_name LIKE ? ESCAPE '\\' OR counterparty_reference LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  params.push(opts.limit ?? 50, opts.offset ?? 0);
  return db.all<LocalTransaction>(
    `SELECT ${COLUMNS} FROM transactions WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`,
    params,
  );
}

export function getLocalTransaction(db: SqlDb, id: string): Promise<LocalTransaction | null> {
  return db.get<LocalTransaction>(`SELECT ${COLUMNS} FROM transactions WHERE id = ?`, [id]);
}

export async function upsertAccounts(db: SqlDb, accounts: ManualAccount[] & { isPrimary?: boolean }[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM accounts");
    for (const a of accounts) {
      await tx.run("INSERT INTO accounts (id, workspace_id, name, currency) VALUES (?, ?, ?, ?)", [a.id, a.workspaceId, a.name, a.currency]);
    }
  });
}

export async function listLocalAccounts(db: SqlDb): Promise<ManualAccount[]> {
  const rows = await db.all<{ id: string; workspace_id: string; name: string; currency: string }>(
    "SELECT id, workspace_id, name, currency FROM accounts ORDER BY is_primary DESC, name",
  );
  return rows.map((r) => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, currency: r.currency as ManualAccount["currency"] }));
}

export const SET_CATEGORY = "set_category";

export type SetCategoryPayload = {
  transaction_id: string;
  category: string;
  subcategory: string | null;
  /** What this device believed the server had when the edit was made (compare-and-set base). */
  base_category: string | null;
  base_subcategory: string | null;
  force: boolean;
};

export class LocalEditError extends Error {}

/**
 * Applies a category edit on the device immediately and queues it. The base is
 * the category this device currently shows; a second edit to the same record
 * therefore builds on the first (they are delivered in order).
 */
export async function setCategoryLocally(
  db: SqlDb,
  input: { transactionId: string; category: string; subcategory: string | null; opId: string; nowIso: string },
): Promise<void> {
  const category = input.category.trim();
  const subcategory = input.subcategory?.trim() || null;
  if (!category || category.length > 80 || (subcategory?.length ?? 0) > 80) throw new LocalEditError("invalid_category");

  await db.transaction(async (tx) => {
    const row = await tx.get<{ category: string | null; subcategory: string | null; sync_state: string }>(
      "SELECT category, subcategory, sync_state FROM transactions WHERE id = ?",
      [input.transactionId],
    );
    if (!row) throw new LocalEditError("not_found");
    const payload: SetCategoryPayload = {
      transaction_id: input.transactionId,
      category,
      subcategory,
      base_category: row.category,
      base_subcategory: row.subcategory,
      force: false,
    };
    await tx.run(
      `UPDATE transactions SET category = ?, subcategory = ?, category_decision_status = 'confirmed', suggested_category = NULL,
         sync_state = CASE WHEN sync_state IN ('synced') THEN 'pending' ELSE sync_state END WHERE id = ?`,
      [category, subcategory, input.transactionId],
    );
    await enqueueOp(tx, { opId: input.opId, entityType: "transaction", entityId: input.transactionId, opType: SET_CATEGORY, payload, nowIso: input.nowIso });
  });
}

const SERVER_COLUMNS = [
  "id", "account_id", "workspace_id", "source", "transaction_type", "direction", "status", "currency",
  "amount_rwf", "fee_rwf", "principal_effect_rwf", "fee_effect_rwf", "settlement_state", "balance_after_rwf",
  "counterparty_name", "counterparty_reference", "occurred_at", "category", "subcategory",
  "category_decision_status", "suggested_category", "dedupe_state", "notes",
];

const UNSYNCED = "('local_only','pending','syncing','conflict','failed')";

/**
 * Applies one page of server changes and advances the cursor in ONE transaction
 * (a crash can't advance the cursor past rows that were never stored).
 * Rules: a row this device still owes the server (unsynced) is never overwritten;
 * a merged duplicate is removed; everything else is stored as synced.
 */
export async function applyServerPage(
  db: SqlDb,
  stream: string,
  rows: ServerTransaction[],
  nowIso: string,
  opts: { advanceCursor: boolean },
): Promise<{ stored: number; removed: number; skippedLocal: number }> {
  let stored = 0;
  let removed = 0;
  let skippedLocal = 0;
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const existing = await tx.get<{ sync_state: string }>("SELECT sync_state FROM transactions WHERE id = ?", [r.id]);
      if (existing && ["local_only", "pending", "syncing", "conflict", "failed"].includes(existing.sync_state)) {
        // A server row for an id this device is still uploading is the ack
        // arriving by the other road. Keep the local copy; completeOp will mark it synced.
        skippedLocal += 1;
        continue;
      }
      if (r.dedupe_state === "merged") {
        await tx.run(`DELETE FROM transactions WHERE id = ? AND sync_state NOT IN ${UNSYNCED}`, [r.id]);
        removed += 1;
        continue;
      }
      await tx.run(
        `INSERT INTO transactions (${SERVER_COLUMNS.join(", ")}, server_updated_at, sync_state, sync_error)
         VALUES (${SERVER_COLUMNS.map(() => "?").join(",")}, ?, 'synced', NULL)
         ON CONFLICT(id) DO UPDATE SET
           account_id=excluded.account_id, workspace_id=excluded.workspace_id, source=excluded.source,
           transaction_type=excluded.transaction_type, direction=excluded.direction, status=excluded.status,
           currency=excluded.currency, amount_rwf=excluded.amount_rwf, fee_rwf=excluded.fee_rwf,
           principal_effect_rwf=excluded.principal_effect_rwf, fee_effect_rwf=excluded.fee_effect_rwf,
           settlement_state=excluded.settlement_state, balance_after_rwf=excluded.balance_after_rwf,
           counterparty_name=excluded.counterparty_name, counterparty_reference=excluded.counterparty_reference,
           occurred_at=excluded.occurred_at, category=excluded.category, subcategory=excluded.subcategory,
           category_decision_status=excluded.category_decision_status, suggested_category=excluded.suggested_category,
           dedupe_state=excluded.dedupe_state, notes=excluded.notes, server_updated_at=excluded.server_updated_at,
           sync_state='synced', sync_error=NULL`,
        [
          r.id, r.account_id, r.workspace_id, r.source, r.transaction_type, r.direction, r.status, r.currency,
          r.amount_rwf, r.fee_rwf, r.principal_effect_rwf, r.fee_effect_rwf, r.settlement_state, r.balance_after_rwf,
          r.counterparty_name, r.counterparty_reference, canonicalInstant(r.occurred_at), r.category, r.subcategory,
          r.category_decision_status, r.suggested_category, r.dedupe_state, r.notes, r.updated_at,
        ],
      );
      stored += 1;
    }
    if (opts.advanceCursor && rows.length > 0) {
      const last = rows[rows.length - 1];
      await tx.run(
        `INSERT INTO sync_state (stream, cursor_updated_at, cursor_id, last_synced_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(stream) DO UPDATE SET cursor_updated_at = excluded.cursor_updated_at, cursor_id = excluded.cursor_id`,
        [stream, last.updated_at, last.id, nowIso],
      );
    }
  });
  return { stored, removed, skippedLocal };
}

export type Cursor = { updatedAt: string | null; id: string | null; lastSyncedAt: string | null; complete: boolean };

export async function getCursor(db: SqlDb, stream: string): Promise<Cursor> {
  const row = await db.get<{ cursor_updated_at: string | null; cursor_id: string | null; last_synced_at: string | null; complete: number }>(
    "SELECT * FROM sync_state WHERE stream = ?",
    [stream],
  );
  return { updatedAt: row?.cursor_updated_at ?? null, id: row?.cursor_id ?? null, lastSyncedAt: row?.last_synced_at ?? null, complete: row?.complete === 1 };
}

export async function markPullComplete(db: SqlDb, stream: string, nowIso: string): Promise<void> {
  await db.run(
    `INSERT INTO sync_state (stream, last_synced_at, complete) VALUES (?, ?, 1)
     ON CONFLICT(stream) DO UPDATE SET last_synced_at = excluded.last_synced_at, complete = 1`,
    [stream, nowIso],
  );
}

/** Forces a full re-download (e.g. suspected missed changes). Unsynced local work is untouched. */
export async function resetCursor(db: SqlDb, stream: string): Promise<void> {
  await db.run("UPDATE sync_state SET cursor_updated_at = NULL, cursor_id = NULL, complete = 0 WHERE stream = ?", [stream]);
}
