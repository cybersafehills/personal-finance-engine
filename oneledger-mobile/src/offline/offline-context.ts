import * as Crypto from "expo-crypto";
import { createContext, useContext } from "react";

import type { OutboxSummary } from "./outbox";
import { deriveSyncStatus, type SyncStatus } from "./status";

// The offline layer's React context, kept free of native modules (expo-sqlite)
// so screens and their tests can import it without pulling the database in.

export const EMPTY_SUMMARY: OutboxSummary = { pending: 0, inFlight: 0, retrying: 0, needsAttention: 0, conflicts: 0 };

export type OfflineValue = {
  status: SyncStatus;
  summary: OutboxSummary;
  lastSyncedAt: string | null;
  available: boolean;
  newId(): string;
  /** Call after any local write: refreshes the counts and triggers a sync. */
  notifyLocalWrite(): void;
  syncNow(): Promise<void>;
  retryHeldOps(): Promise<void>;
};

export const OfflineContext = createContext<OfflineValue>({
  status: deriveSyncStatus({ available: false, online: true, syncing: false, summary: EMPTY_SUMMARY, authNeeded: false }),
  summary: EMPTY_SUMMARY,
  lastSyncedAt: null,
  available: false,
  newId: () => Crypto.randomUUID(),
  notifyLocalWrite: () => {},
  syncNow: async () => {},
  retryHeldOps: async () => {},
});


export function useOffline(): OfflineValue {
  return useContext(OfflineContext);
}
