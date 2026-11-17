// A tiny, serialized SQL surface over any SQLite binding. The app uses
// expo-sqlite (encrypted with SQLCipher); tests use Node's built-in SQLite.
// Everything above this file depends only on `SqlDb`.
//
// Why serialized: expo-sqlite shares one connection, so a query issued while a
// transaction is open would silently join it. Every operation therefore waits
// its turn on one lock; code inside `transaction()` receives a handle that
// bypasses the lock (it already holds it).

export type SqlValue = string | number | null;

export interface SqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Atomic: commits when `fn` resolves, rolls everything back if it throws. */
  transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T>;
}

/** What a SQLite binding must provide. */
export interface RawSql {
  exec(sql: string): Promise<void>;
  run(sql: string, params: SqlValue[]): Promise<void>;
  all(sql: string, params: SqlValue[]): Promise<unknown[]>;
}

export function createSqlDb(raw: RawSql): SqlDb {
  let tail: Promise<unknown> = Promise.resolve();

  function locked<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  }

  const direct: SqlDb = {
    exec: (sql) => raw.exec(sql),
    run: (sql, params = []) => raw.run(sql, params),
    all: async <T>(sql: string, params: SqlValue[] = []) => (await raw.all(sql, params)) as T[],
    get: async <T>(sql: string, params: SqlValue[] = []) =>
      ((await raw.all(sql, params))[0] as T | undefined) ?? null,
    transaction: () => {
      throw new Error("Nested transactions are not supported.");
    },
  };

  return {
    exec: (sql) => locked(() => direct.exec(sql)),
    run: (sql, params) => locked(() => direct.run(sql, params)),
    all: <T>(sql: string, params?: SqlValue[]) => locked(() => direct.all<T>(sql, params)),
    get: <T>(sql: string, params?: SqlValue[]) => locked(() => direct.get<T>(sql, params)),
    transaction: <T>(fn: (tx: SqlDb) => Promise<T>) =>
      locked(async () => {
        await raw.exec("BEGIN IMMEDIATE");
        try {
          const value = await fn(direct);
          await raw.exec("COMMIT");
          return value;
        } catch (error) {
          try {
            await raw.exec("ROLLBACK");
          } catch {
            // Already rolled back by SQLite (e.g. disk full); surface the original error.
          }
          throw error;
        }
      }),
  };
}
