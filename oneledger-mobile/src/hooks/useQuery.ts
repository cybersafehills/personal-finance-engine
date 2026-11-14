import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

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
export function useQuery<T>(load: () => Promise<T>): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const run = useCallback(
    async (userInitiated: boolean) => {
      const id = ++requestId.current;
      if (userInitiated) setRefreshing(true);
      try {
        const next = await load();
        if (id !== requestId.current) return;
        setData(next);
        setError(null);
      } catch {
        if (id !== requestId.current) return;
        setError("Couldn't load this. Check your connection and try again.");
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [load],
  );

  useFocusEffect(
    useCallback(() => {
      run(false);
    }, [run]),
  );

  const refresh = useCallback(() => {
    run(true);
  }, [run]);

  return { data, loading, refreshing, error, refresh };
}
