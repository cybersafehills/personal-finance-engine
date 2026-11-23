import { subscribeRuntime } from "@/offline/runtime";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";

export type QueryState<T> = {
  data: T | null;
  /** True only for the first load (nothing to show yet). */
  loading: boolean;
  /** True while a pull-to-refresh is running. */
  refreshing: boolean;
  error: string | null;
  refresh(): void;
};

/**
 * Loads data when the screen gains focus and on demand. Keeps showing the
 * previous data while reloading, so returning to a tab never flashes empty.
 * A stale response (an older request finishing after a newer one) is dropped.
 */
export function useQuery<T>(load: () => Promise<T>, queryKey = ""): QueryState<T> {
  const { activeId: spaceId } = useActiveSpace();
  const activeId = `${spaceId ?? "none"}|${queryKey}`;
  const currentScope = useRef(activeId);
  useEffect(() => { currentScope.current = activeId; }, [activeId]);
  const [result, setResult] = useState<{ scope: string | null; data: T } | null>(null);
  const data = result?.scope === activeId ? result.data : null;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const run = useCallback(
    async (userInitiated: boolean) => {
      const id = ++requestId.current;
      const scope = activeId;
      setError(null);
      if (userInitiated) setRefreshing(true);
      try {
        const next = await load();
        if (id !== requestId.current || currentScope.current !== scope) return;
        setResult({ scope, data: next });
        setError(null);
      } catch {
        if (id !== requestId.current || currentScope.current !== scope) return;
        setResult(null);
        setError("Couldn't load this. Check your connection and try again.");
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [load, activeId],
  );

  useFocusEffect(
    useCallback(() => {
      run(false);
    }, [run]),
  );

  // Switching Space reloads (the focus effect above only fires on focus).
  const lastSpace = useRef(activeId);
  useEffect(() => {
    if (lastSpace.current === activeId) return;
    lastSpace.current = activeId;
    run(false);
  }, [activeId, run]);

  useEffect(() => subscribeRuntime(() => { setResult(null); void run(false); }), [run]);

  const refresh = useCallback(() => {
    run(true);
  }, [run]);

  return { data, loading: loading || (result !== null && result.scope !== activeId && !error), refreshing, error, refresh };
}
