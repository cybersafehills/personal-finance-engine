import type { SqlDb } from "./sql";

// Web has no encrypted local database (the web build is a development preview
// only), so offline storage is unavailable there and the app stays online-only.
// This file exists so Metro never bundles expo-sqlite's wasm worker for web.

export class OfflineUnavailableError extends Error {
  constructor(readonly reason: "no_encryption" | "key_lost" | "open_failed", message: string) {
    super(message);
  }
}

export type OpenedDb = { db: SqlDb; close(): Promise<void>; slug: string };

export async function openUserDatabase(): Promise<OpenedDb> {
  throw new OfflineUnavailableError("no_encryption", "Offline storage isn't available on web.");
}

export async function destroyUserDatabase(): Promise<void> {}
