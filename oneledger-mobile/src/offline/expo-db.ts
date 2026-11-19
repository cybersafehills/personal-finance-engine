import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";

import { deviceStore } from "@/lib/device-store";

import { migrate } from "./migrations";
import { createSqlDb, type SqlDb } from "./sql";

// The encrypted on-device database, one per signed-in user.
//
//  - Encryption: SQLCipher (expo-sqlite config plugin `useSQLCipher`). If the
//    running binary does not include it (Expo Go, or a build that predates the
//    plugin) we REFUSE to open: financial data is never written unencrypted.
//    The app then runs online-only exactly as before.
//  - Key: 32 random bytes, generated on first use, kept in the Keychain /
//    Keystore (this-device-only, never in backups) and never stored beside the
//    database.
//  - Isolation: the file name is derived from the user id, so one account can
//    never open another's data; there is no shared "cache".

export class OfflineUnavailableError extends Error {
  constructor(readonly reason: "no_encryption" | "key_lost" | "open_failed", message: string) {
    super(message);
  }
}

async function userSlug(userId: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `ol-offline:${userId}`);
  return digest.slice(0, 24);
}

async function getOrCreateKey(slug: string): Promise<{ key: string; created: boolean }> {
  const name = `ol.offline.key.${slug}`;
  const existing = await deviceStore.get(name);
  if (existing) return { key: existing, created: false };
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await deviceStore.set(name, key);
  return { key, created: true };
}

export type OpenedDb = { db: SqlDb; close(): Promise<void>; slug: string };

export async function openUserDatabase(userId: string): Promise<OpenedDb> {
  const slug = await userSlug(userId);
  const file = `ol-${slug}.db`;
  const { key, created } = await getOrCreateKey(slug);

  const open = async () => {
    const native = await SQLite.openDatabaseAsync(file);
    // `PRAGMA cipher_version` returns a row only when SQLCipher is linked.
    const cipher = await native.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version");
    if (cipher == null) {
      await native.closeAsync();
      throw new OfflineUnavailableError(
        "no_encryption",
        "This build has no database encryption, so offline storage is switched off.",
      );
    }
    try {
    await native.execAsync(`PRAGMA key = "x'${key}'"`);
    // Reading the schema proves the key is right (a wrong key reads as "not a database").
    await native.getAllAsync("SELECT count(*) FROM sqlite_master");
    await native.execAsync("PRAGMA journal_mode = WAL");
    return native;
    } catch (error) {
      await native.closeAsync().catch(() => undefined);
      throw error;
    }
  };

  let native: SQLite.SQLiteDatabase;
  try {
    native = await open();
  } catch (error) {
    if (error instanceof OfflineUnavailableError) throw error;
    // An open/read error cannot prove key loss. Never erase pending financial
    // records for storage-full, transient, corruption or schema errors.
    throw new OfflineUnavailableError(created ? "key_lost" : "open_failed",
      "Your saved data could not be opened. It has been kept on this phone. Try again or contact support before removing local data.");
  }

  const db = createSqlDb({
    exec: (sql) => native.execAsync(sql),
    run: async (sql, params) => void (await native.runAsync(sql, params)),
    all: (sql, params) => native.getAllAsync(sql, params),
  });
  try { await migrate(db); } catch (error) { await native.closeAsync(); throw error; }
  return { db, slug, close: () => native.closeAsync() };
}

/** Removes a user's local database and key (explicit account removal). */
export async function destroyUserDatabase(userId: string): Promise<void> {
  const slug = await userSlug(userId);
  await SQLite.deleteDatabaseAsync(`ol-${slug}.db`);
  await deviceStore.remove(`ol.offline.key.${slug}`);
}
