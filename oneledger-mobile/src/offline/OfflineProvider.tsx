import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

import { useSession } from "@/features/auth/SessionProvider";
import { config } from "@/lib/config";

import { OfflineUnavailableError, openUserDatabase, type OpenedDb } from "./expo-db";
import { EMPTY_SUMMARY, OfflineContext, type OfflineValue } from "./offline-context";
import { getCursor } from "./local-store";
import { retryHeld, summarizeOutbox, type OutboxSummary } from "./outbox";
import { setLocalWriteHandler, setOfflineRuntime } from "./runtime";
import { deriveSyncStatus } from "./status";
import { runSync, TX_STREAM, type SyncReport } from "./sync-engine";
import { supabaseTransport } from "./transport";

// Owns the open local database for the signed-in user and decides WHEN to sync:
// on launch, on returning to the foreground, when connectivity comes back, after
// every local save, and on a timer while changes are waiting. Correctness never
// depends on any of those firing: every operation is durable and idempotent.

const WAITING_POLL_MS = 30_000;

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const opened = useRef<OpenedDb | null>(null);
  const [available, setAvailable] = useState(false);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [summary, setSummary] = useState<OutboxSummary>(EMPTY_SUMMARY);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const refreshCounts = useCallback(async () => {
    const db = opened.current?.db;
    if (!db) return;
    setSummary(await summarizeOutbox(db));
    setLastSyncedAt((await getCursor(db, TX_STREAM)).lastSyncedAt);
  }, []);

  const syncNow = useCallback(
    async (ignoreBackoff = true) => {
      const handle = opened.current;
      if (!handle) return;
      setSyncing(true);
      try {
        const report: SyncReport = await runSync({ db: handle.db, transport: supabaseTransport, ignoreBackoff });
        setAuthNeeded(report.stoppedFor === "auth");
        // Reachability is learned from the attempt itself, not from the OS flag.
        setOnline(report.stoppedFor !== "offline");
        if (userId && (await getCursor(handle.db, TX_STREAM)).complete) {
          setOfflineRuntime({ db: handle.db, userId, bootstrapped: true });
        }
      } finally {
        setSyncing(false);
        await refreshCounts();
      }
    },
    [refreshCounts, userId],
  );

  // Open (and close) the database with the signed-in user. Switching accounts
  // closes the previous user's database before anything else renders.
  useEffect(() => {
    if (!userId || !config.supabaseUrl || config.offlineDisabled) return;
    let cancelled = false;
    (async () => {
      try {
        const handle = await openUserDatabase(userId);
        if (cancelled) {
          await handle.close();
          return;
        }
        opened.current = handle;
        const complete = (await getCursor(handle.db, TX_STREAM)).complete;
        setOfflineRuntime({ db: handle.db, userId, bootstrapped: complete });
        setAvailable(true);
        await refreshCounts();
        void syncNow(true);
      } catch (error) {
        // No encryption / unreadable store: stay online-only, never fall back to plaintext.
        if (!(error instanceof OfflineUnavailableError)) console.warn("offline: could not start", error instanceof Error ? error.message : String(error));
        setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
      setOfflineRuntime(null);
      const handle = opened.current;
      opened.current = null;
      setAvailable(false);
      setSummary(EMPTY_SUMMARY);
      setLastSyncedAt(null);
      void handle?.close();
    };
  }, [userId, refreshCounts, syncNow]);

  // Triggers: foreground, connectivity, and a poll while something is waiting.
  useEffect(() => {
    if (!available) return;
    const appState = AppState.addEventListener("change", (s) => s === "active" && void syncNow(true));
    const net = Network.addNetworkStateListener((state) => {
      setOnline(state.isConnected !== false);
      if (state.isConnected) void syncNow(true);
    });
    void Network.getNetworkStateAsync().then((s) => setOnline(s.isConnected !== false)).catch(() => undefined);
    return () => {
      appState.remove();
      net.remove();
    };
  }, [available, syncNow]);

  useEffect(() => {
    if (!available) return;
    setLocalWriteHandler(() => {
      void refreshCounts();
      void syncNow(false);
    });
    return () => setLocalWriteHandler(null);
  }, [available, refreshCounts, syncNow]);

  const waiting = summary.pending + summary.retrying + summary.inFlight;
  useEffect(() => {
    if (!available || waiting === 0) return;
    const timer = setInterval(() => void syncNow(false), WAITING_POLL_MS);
    return () => clearInterval(timer);
  }, [available, waiting, syncNow]);

  const syncOnDemand = useCallback(() => syncNow(true), [syncNow]);
  const value = useMemo<OfflineValue>(
    () => ({
      status: deriveSyncStatus({ available, online, syncing, summary, authNeeded }),
      summary,
      lastSyncedAt,
      available,
      newId: () => Crypto.randomUUID(),
      notifyLocalWrite: () => {
        void refreshCounts();
        void syncNow(false);
      },
      syncNow: syncOnDemand,
      retryHeldOps: async () => {
        if (opened.current) await retryHeld(opened.current.db);
        await syncNow(true);
      },
    }),
    [available, online, syncing, summary, authNeeded, lastSyncedAt, refreshCounts, syncNow, syncOnDemand],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
