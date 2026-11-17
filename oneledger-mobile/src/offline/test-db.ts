import { DatabaseSync } from "node:sqlite";

import { migrate } from "./migrations";
import { createSqlDb, type RawSql, type SqlDb, type SqlValue } from "./sql";

// Test-only: real SQLite (Node's built-in) behind the same SqlDb the app uses,
// so repository, outbox and sync tests exercise genuine SQL and transactions.

export function nodeRaw(file = ":memory:"): { raw: RawSql; close(): void } {
  const handle = new DatabaseSync(file);
  return {
    raw: {
      exec: async (sql) => void handle.exec(sql),
      run: async (sql, params) => void handle.prepare(sql).run(...(params as SqlValue[])),
      all: async (sql, params) => handle.prepare(sql).all(...(params as SqlValue[])),
    },
    close: () => handle.close(),
  };
}

export async function openTestDb(file?: string): Promise<{ db: SqlDb; close(): void }> {
  const { raw, close } = nodeRaw(file);
  const db = createSqlDb(raw);
  await migrate(db);
  return { db, close };
}
