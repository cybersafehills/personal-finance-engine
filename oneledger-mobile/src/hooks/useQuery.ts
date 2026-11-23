import { useFocusEffect } from "expo-router";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { subscribeRuntime } from "@/offline/runtime";

export type QueryState<T> = {
  data: T | null; loading: boolean; refreshing: boolean; error: string | null; refresh(): void;
};

/** Keeps refresh results within their originating Space and ignores stale responses. */
export function useQuery<T>(rawLoad: () => Promise<T>, optionsOrKey: { refreshIntervalMs?: number } | string = {}): QueryState<T> {
  // A string is a query key (used by screens that pass an inline loader): the loader is read through a
  // ref so a new function each render does not refetch; a changed key does.
  const queryKey = typeof optionsOrKey === "string" ? optionsOrKey : null;
  const options = typeof optionsOrKey === "string" ? {} : optionsOrKey;
  const loadRef = useRef(rawLoad);
  useLayoutEffect(() => { loadRef.current = rawLoad; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const keyedLoad = useCallback(() => loadRef.current(), [queryKey]);
  const load = queryKey === null ? rawLoad : keyedLoad;
  const { activeId } = useActiveSpace();
  const [snapshot, setSnapshot] = useState<{ space: string | null; value: T } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<{ space: string | null; message: string } | null>(null);
  const requestId = useRef(0);
  const inFlight = useRef<{ load: typeof load; space: string | null; id: number; promise: Promise<void>; rerun: boolean } | null>(null);
  const run = useCallback(function execute(userInitiated: boolean, changed = false): Promise<void> {
    if (userInitiated) setRefreshing(true);
    const previous = inFlight.current;
    if (previous && previous.id === requestId.current && previous.load === load && previous.space === activeId) {
      // One trailing read catches writes committed during an ongoing read.
      previous.rerun ||= changed || userInitiated;
      return previous.promise;
    }
    const id = ++requestId.current;
    const job = { load, space: activeId, id, promise: Promise.resolve(), rerun: false };
    inFlight.current = job;
    job.promise = (async () => {
      try {
        const next = await load();
        if (id !== requestId.current) return;
        setSnapshot({ space: activeId, value: next });
        setFailure(null);
      } catch {
        if (id !== requestId.current) return;
        setFailure({ space: activeId, message: "Couldn't load this. Check your connection and try again." });
      } finally {
        if (inFlight.current === job) inFlight.current = null;
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
          if (job.rerun) void execute(false);
        }
      }
    })();
    return job.promise;
  }, [load, activeId]);
  const interval = options.refreshIntervalMs;
  useFocusEffect(useCallback(() => {
    void run(false);
    const unsubscribe = subscribeRuntime(() => void run(false, true));
    const app = AppState.addEventListener("change", (state) => { if (state === "active") void run(false); });
    const timer = interval ? setInterval(() => void run(false), interval) : undefined;
    return () => { requestId.current++; unsubscribe(); app.remove(); if (timer) clearInterval(timer); };
  }, [run, interval]));
  const data = snapshot?.space === activeId ? snapshot.value : null;
  const error = failure?.space === activeId ? failure.message : null;
  const refresh = useCallback(() => { void run(true); }, [run]);
  return { data, loading: loading || (snapshot?.space !== activeId && !error), refreshing, error, refresh };
}
