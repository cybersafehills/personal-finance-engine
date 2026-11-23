import type { SqlDb } from "./sql";

// Versioned local schema. `PRAGMA user_version` records how far this device's
// database has come; each step runs in one transaction together with its
// version bump, so an interrupted upgrade leaves the previous version intact.
// Steps are additive and never drop user data. A database NEWER than this build
// (an older app opened after a newer one) is refused rather than mangled.

export const LOCAL_SCHEMA_VERSION = 3;

const STEPS: { version: number; sql: string[] }[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE accounts (
         id TEXT PRIMARY KEY,
         workspace_id TEXT NOT NULL,
         name TEXT NOT NULL,
         currency TEXT NOT NULL,
         is_primary INTEGER NOT NULL DEFAULT 0
       )`,
      // Mirrors the server's transactions columns (names kept identical so a
      // server row maps 1:1). sync_state is independent of settlement_state:
      // the former is about this device's copy, the latter about the money.
      `CREATE TABLE transactions (
         id TEXT PRIMARY KEY,
         account_id TEXT,
         workspace_id TEXT,
         source TEXT NOT NULL,
         transaction_type TEXT NOT NULL,
         direction TEXT NOT NULL,
         status TEXT NOT NULL,
         currency TEXT NOT NULL,
         amount_rwf INTEGER NOT NULL,
         fee_rwf INTEGER NOT NULL DEFAULT 0,
         principal_effect_rwf INTEGER,
         fee_effect_rwf INTEGER,
         settlement_state TEXT,
         balance_after_rwf INTEGER,
         counterparty_name TEXT,
         counterparty_reference TEXT,
         occurred_at TEXT NOT NULL,
         category TEXT,
         subcategory TEXT,
         category_decision_status TEXT NOT NULL DEFAULT 'uncategorized',
         suggested_category TEXT,
         dedupe_state TEXT NOT NULL DEFAULT 'unique',
         notes TEXT,
         server_updated_at TEXT,
         sync_state TEXT NOT NULL DEFAULT 'synced'
           CHECK (sync_state IN ('local_only','pending','syncing','synced','conflict','failed')),
         sync_error TEXT
       )`,
      `CREATE INDEX idx_tx_occurred ON transactions (occurred_at DESC, id)`,
      `CREATE INDEX idx_tx_account ON transactions (account_id, occurred_at DESC)`,
      `CREATE INDEX idx_tx_sync ON transactions (sync_state)`,
      // The durable outbox. seq gives replay order; op_id is the server-side
      // idempotency key and never changes across retries.
      `CREATE TABLE outbox (
         op_id TEXT PRIMARY KEY,
         seq INTEGER NOT NULL UNIQUE,
         entity_type TEXT NOT NULL,
         entity_id TEXT NOT NULL,
         op_type TEXT NOT NULL,
         payload TEXT NOT NULL,
         depends_on TEXT,
         state TEXT NOT NULL DEFAULT 'pending'
           CHECK (state IN ('pending','in_flight','retry','rejected','stalled')),
         attempts INTEGER NOT NULL DEFAULT 0,
         next_attempt_at INTEGER NOT NULL DEFAULT 0,
         last_error TEXT,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX idx_outbox_state ON outbox (state, seq)`,
      `CREATE TABLE sync_state (
         stream TEXT PRIMARY KEY,
         cursor_updated_at TEXT,
         cursor_id TEXT,
         last_synced_at TEXT,
         complete INTEGER NOT NULL DEFAULT 0
       )`,
    ],
  },
  {
    // v2: outbox gains a 'conflict' state (an edit the server refused because the
    // field changed underneath it) and the server's values to choose from.
    // SQLite cannot alter a CHECK constraint, so the table is rebuilt; rows copied as-is.
    version: 2,
    sql: [
      `CREATE TABLE outbox_v2 (
         op_id TEXT PRIMARY KEY,
         seq INTEGER NOT NULL UNIQUE,
         entity_type TEXT NOT NULL,
         entity_id TEXT NOT NULL,
         op_type TEXT NOT NULL,
         payload TEXT NOT NULL,
         depends_on TEXT,
         state TEXT NOT NULL DEFAULT 'pending'
           CHECK (state IN ('pending','in_flight','retry','rejected','stalled','conflict')),
         attempts INTEGER NOT NULL DEFAULT 0,
         next_attempt_at INTEGER NOT NULL DEFAULT 0,
         last_error TEXT,
         created_at TEXT NOT NULL,
         conflict_data TEXT
       )`,
      `INSERT INTO outbox_v2 (op_id, seq, entity_type, entity_id, op_type, payload, depends_on, state, attempts, next_attempt_at, last_error, created_at)
         SELECT op_id, seq, entity_type, entity_id, op_type, payload, depends_on, state, attempts, next_attempt_at, last_error, created_at FROM outbox`,
      `DROP TABLE outbox`,
      `ALTER TABLE outbox_v2 RENAME TO outbox`,
      `CREATE INDEX idx_outbox_state ON outbox (state, seq)`,
      `CREATE INDEX idx_outbox_entity ON outbox (entity_id, seq)`,
    ],
  },
  { version: 3, sql: [
    `ALTER TABLE transactions ADD COLUMN is_own_transfer INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE transactions ADD COLUMN visibility_revoked INTEGER NOT NULL DEFAULT 0`,
    `CREATE TABLE workspace_leases (workspace_id TEXT PRIMARY KEY, kind TEXT NOT NULL, checked_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
    `CREATE TABLE wallet_snapshots (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, payload TEXT NOT NULL)`,
    `CREATE TABLE snapshot_seen (id TEXT PRIMARY KEY)`,
    `CREATE INDEX idx_tx_workspace_date ON transactions(workspace_id, occurred_at DESC, id)`,
  ] },
];

export class MigrationError extends Error {}

export async function migrate(db: SqlDb): Promise<void> {
  const row = await db.get<{ user_version: number }>("PRAGMA user_version");
  const current = row?.user_version ?? 0;
  if (current > LOCAL_SCHEMA_VERSION) {
    throw new MigrationError(
      `This device's local data is from a newer OneLedger (v${current}). Update the app to continue.`,
    );
  }
  for (const step of STEPS) {
    if (step.version <= current) continue;
    try {
      await db.transaction(async (tx) => {
        for (const statement of step.sql) await tx.exec(statement);
        await tx.exec(`PRAGMA user_version = ${step.version}`);
      });
    } catch (cause) {
      throw new MigrationError(
        `Local database upgrade to v${step.version} failed: ${cause instanceof Error ? cause.message : "unknown error"}`,
      );
    }
  }
}
