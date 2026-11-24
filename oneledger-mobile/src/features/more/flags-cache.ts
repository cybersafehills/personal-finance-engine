import { useCallback, useEffect, useSyncExternalStore } from "react";

import { fetchMoreFlags } from "@/api/mobile-api";
import { useQuery } from "@/hooks/useQuery";
import { deviceStore } from "@/lib/device-store";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";

import type { MoreFlags } from "./groups";

// More and Settings hide features the server says are off, and show dark-by-default ones
// (Bills, Payment activity...) only once it says they are on. Reading that answer fresh on
// every visit made those rows pop in a few seconds after the page drew. So the last answer
// for each Space is kept in memory and on this phone: a screen draws with it at once, and
// the fresh answer replaces it quietly. It is only a display hint; the server still decides
// what a tap can do.

const KEY = "ol.more-flags.v1";
let bySpace: Record<string, MoreFlags> = {};
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function hydrateMoreFlags(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await deviceStore.get(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") bySpace = { ...parsed, ...bySpace };
      emit();
    }
  } catch {
    // Unreadable: the first fresh answer fills it.
  }
}

export function rememberMoreFlags(space: string | null, flags: MoreFlags | null): void {
  if (!space || !flags) return;
  if (JSON.stringify(bySpace[space]) === JSON.stringify(flags)) return;
  bySpace = { ...bySpace, [space]: flags };
  emit();
  void deviceStore.set(KEY, JSON.stringify(bySpace)).catch(() => {});
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The remembered flags for this Space, replaced as soon as a fresh answer arrives; null only before anything is known. */
export function useMoreFlags(): MoreFlags | null {
  const { activeId } = useActiveSpace();
  const load = useCallback(() => fetchMoreFlags(), []);
  const { data: fresh } = useQuery(load);
  useEffect(() => { void hydrateMoreFlags(); }, []);
  useEffect(() => { rememberMoreFlags(activeId, fresh); }, [activeId, fresh]);
  const stored = useSyncExternalStore(subscribe, () => (activeId ? bySpace[activeId] : undefined) ?? null, () => null);
  return fresh ?? stored;
}

/** Keeps the remembered flags warm from the app shell, so even the first visit to More has them. */
export function useWarmMoreFlags(): void {
  useMoreFlags();
}

/** For tests. */
export function resetMoreFlagsCache(): void {
  bySpace = {};
  hydrated = false;
}
