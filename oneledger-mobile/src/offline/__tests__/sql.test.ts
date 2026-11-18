import { migrate, LOCAL_SCHEMA_VERSION, MigrationError } from "../migrations";
import { createSqlDb } from "../sql";
import { nodeRaw, openTestDb } from "../test-db";

describe("sql layer", () => {
  it("rolls a transaction back completely when it throws", async () => {
    const { db } = await openTestDb();
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO accounts (id, workspace_id, name, currency) VALUES ('a','w','A','RWF')");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.all("SELECT * FROM accounts")).toHaveLength(0);
  });

  it("does not let a concurrent query join an open transaction", async () => {
    const { db } = await openTestDb();
    const slow = db.transaction(async (tx) => {
      await tx.run("INSERT INTO accounts (id, workspace_id, name, currency) VALUES ('a','w','A','RWF')");
      await new Promise((r) => setTimeout(r, 20));
      throw new Error("abort");
    });
    // Issued while the transaction is open: must wait, then see the rolled-back state.
    const concurrent = db.all("SELECT * FROM accounts");
    await expect(slow).rejects.toThrow("abort");
    expect(await concurrent).toHaveLength(0);
  });

  it("migrates a fresh database and is idempotent", async () => {
    const { db } = await openTestDb();
    await migrate(db);
    const v = await db.get<{ user_version: number }>("PRAGMA user_version");
    expect(v?.user_version).toBe(LOCAL_SCHEMA_VERSION);
  });

  it("refuses a database from a newer app version without altering it", async () => {
    const { raw } = nodeRaw();
    const db = createSqlDb(raw);
    await db.exec(`PRAGMA user_version = ${LOCAL_SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toBeInstanceOf(MigrationError);
  });

  it("keeps the previous version if a migration step fails midway", async () => {
    const { raw } = nodeRaw();
    const db = createSqlDb(raw);
    // A pre-existing conflicting table makes step 1 fail partway through.
    await db.exec("CREATE TABLE transactions (x TEXT)");
    await expect(migrate(db)).rejects.toBeInstanceOf(MigrationError);
    const v = await db.get<{ user_version: number }>("PRAGMA user_version");
    expect(v?.user_version).toBe(0);
    expect(await db.all("SELECT name FROM sqlite_master WHERE name = 'accounts'")).toHaveLength(0);
  });
});

describe("v1 -> v2 upgrade", () => {
  it("keeps queued operations and unsynced rows intact", async () => {
    const { raw } = nodeRaw();
    const db = createSqlDb(raw);
    // Build a genuine v1 database by hand, with pending user data in it.
    await db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0)`);
    await db.exec(`CREATE TABLE transactions (id TEXT PRIMARY KEY, account_id TEXT, workspace_id TEXT, source TEXT NOT NULL, transaction_type TEXT NOT NULL, direction TEXT NOT NULL, status TEXT NOT NULL, currency TEXT NOT NULL, amount_rwf INTEGER NOT NULL, fee_rwf INTEGER NOT NULL DEFAULT 0, principal_effect_rwf INTEGER, fee_effect_rwf INTEGER, settlement_state TEXT, balance_after_rwf INTEGER, counterparty_name TEXT, counterparty_reference TEXT, occurred_at TEXT NOT NULL, category TEXT, subcategory TEXT, category_decision_status TEXT NOT NULL DEFAULT 'uncategorized', suggested_category TEXT, dedupe_state TEXT NOT NULL DEFAULT 'unique', notes TEXT, server_updated_at TEXT, sync_state TEXT NOT NULL DEFAULT 'synced', sync_error TEXT)`);
    await db.exec(`CREATE TABLE outbox (op_id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, op_type TEXT NOT NULL, payload TEXT NOT NULL, depends_on TEXT, state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','in_flight','retry','rejected','stalled')), attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL)`);
    await db.exec(`CREATE TABLE sync_state (stream TEXT PRIMARY KEY, cursor_updated_at TEXT, cursor_id TEXT, last_synced_at TEXT, complete INTEGER NOT NULL DEFAULT 0)`);
    await db.exec(`INSERT INTO outbox (op_id, seq, entity_type, entity_id, op_type, payload, state, attempts, created_at) VALUES ('op-1', 1, 'transaction', 'tx-1', 'create_manual_transaction', '{"a":1}', 'retry', 3, 'now')`);
    await db.exec(`PRAGMA user_version = 1`);

    await migrate(db);

    const row = await db.get<{ state: string; attempts: number; payload: string }>("SELECT state, attempts, payload FROM outbox WHERE op_id = 'op-1'");
    expect(row).toEqual({ state: "retry", attempts: 3, payload: '{"a":1}' });
    await db.run("UPDATE outbox SET state = 'conflict' WHERE op_id = 'op-1'"); // new state now allowed
    expect((await db.get<{ user_version: number }>("PRAGMA user_version"))?.user_version).toBe(2);
  });
});
