import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { subscribeRuntime } from "@/offline/runtime";

export type QueryState<T> = {
  data: T | null; loading: boolean; refreshing: boolean; error: string | null; refresh(): void;
};

/** Keeps refresh results within their originating Space and ignores stale responses. */
export function useQuery<T>(load: () => Promise<T>, options: { refreshIntervalMs?: number } = {}): QueryState<T> {
  const { activeId } = useActiveSpace();
  const [snapshot, setSnapshot] = useState<{ space: string | null; value: T } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<{ space: string | null; message: string } | null>(null);
  const requestId = useRef(0);
  const run = useCallback(async (userInitiated: boolean) => {
    const id = ++requestId.current;
    if (userInitiated) setRefreshing(true);
    try {
      const next = await load();
      if (id !== requestId.current) return;
      setSnapshot({ space: activeId, value: next });
      setFailure(null);
    } catch {
      if (id !== requestId.current) return;
      setFailure({ space: activeId, message: "Couldn't load this. Check your connection and try again." });
    } finally {
      if (id === requestId.current) { setLoading(false); setRefreshing(false); }
    }
  }, [load, activeId]);
  const interval = options.refreshIntervalMs;
  useFocusEffect(useCallback(() => {
    void run(false);
    const unsubscribe = subscribeRuntime(() => void run(false));
    const app = AppState.addEventListener("change", (state) => { if (state === "active") void run(false); });
    const timer = interval ? setInterval(() => void run(false), interval) : undefined;
    return () => { requestId.current++; unsubscribe(); app.remove(); if (timer) clearInterval(timer); };
  }, [run, interval]));
  const data = snapshot?.space === activeId ? snapshot.value : null;
  const error = failure?.space === activeId ? failure.message : null;
  const refresh = useCallback(() => { void run(true); }, [run]);
  return { data, loading: loading || (snapshot?.space !== activeId && !error), refreshing, error, refresh };
}
