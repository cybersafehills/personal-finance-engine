import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useSession } from "@/features/auth/SessionProvider";
import { deviceStore } from "@/lib/device-store";

import { getSpaces } from "./queries";
import { setRequestedWorkspace } from "./request-space";
import { isSpaceKind, requestedWorkspaceId, resolveActiveSpace, storageKey, type Space } from "./spaces";

type ActiveSpaceValue = {
  spaces: readonly Space[];
  active: Space | null;
  /** Changes with every switch; data hooks reload when it does. */
  activeId: string | null;
  setActive(id: string): void;
  /** After creating a Space: reload the list and switch to it. */
  activateCreated(id: string): Promise<void>;
};

const Context = createContext<ActiveSpaceValue>({
  spaces: [],
  active: null,
  activeId: null,
  setActive: () => {},
  activateCreated: async () => {},
});

/**
 * Which Space the user is viewing. The choice is remembered per user on the
 * device, validated against current memberships (a revoked Space falls back to
 * Personal), and cleared on sign-out. Failing to load the list is not fatal:
 * the saved membership list preserves the selected Space for offline reads.
 */
const NO_SPACES: readonly Space[] = [];

type Loaded = { userId: string; spaces: readonly Space[]; active: Space | null };

export function ActiveSpaceProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // State from another user (or none) is never shown: signing out, or in as
  // someone else, reads as "no Spaces" without resetting state in an effect.
  const current = loaded && loaded.userId === userId ? loaded : null;
  const spaces = current?.spaces ?? NO_SPACES;
  const active = current?.active ?? null;

  useEffect(() => {
    if (!userId) {
      setRequestedWorkspace(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [list, stored] = await Promise.all([
          getSpaces(),
          deviceStore.get(storageKey(userId)),
        ]);
        if (cancelled) return;
        void deviceStore.set(`ol.spaces.v1.${userId}`, JSON.stringify(list)).catch(() => {});
        const next = resolveActiveSpace(list, stored);
        setRequestedWorkspace(requestedWorkspaceId(next));
        setLoaded({ userId, spaces: list, active: next });
      } catch {
        // Restore the last known scope for offline reads; online RLS still applies.
        if (cancelled) return;
        const [saved, selected] = await Promise.all([deviceStore.get(`ol.spaces.v1.${userId}`), deviceStore.get(storageKey(userId))]).catch(() => [null, null]);
        if (cancelled) return;
        let cached: Space[] = [];
        try {
          const parsed: unknown = saved ? JSON.parse(saved) : [];
          if (Array.isArray(parsed)) cached = parsed.filter((s): s is Space => !!s && typeof s.id === "string" && typeof s.name === "string" && isSpaceKind(s.kind) && typeof s.role === "string");
        } catch { /* A missing cache cannot authorize any online read. */ }
        const next = resolveActiveSpace(cached, selected);
        setRequestedWorkspace(requestedWorkspaceId(next));
        setLoaded({ userId, spaces: cached, active: next });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setActive = useCallback(
    (id: string) => {
      const next = spaces.find((s) => s.id === id);
      if (!next || !userId) return;
      void deviceStore.set(storageKey(userId), id);
      // Before state, so the reload that follows already names the new Space.
      setRequestedWorkspace(requestedWorkspaceId(next));
      setLoaded({ userId, spaces, active: next });
    },
    [spaces, userId],
  );

  const activateCreated = useCallback(
    async (id: string) => {
      if (!userId) return;
      // The new Space is not in the list yet: read it, then switch to it. If
      // the read fails the Space still exists; it shows up on the next load.
      try {
        const list = await getSpaces();
        const next = list.find((s) => s.id === id) ?? resolveActiveSpace(list, null);
        void deviceStore.set(storageKey(userId), next?.id ?? id);
        setRequestedWorkspace(requestedWorkspaceId(next));
        setLoaded({ userId, spaces: list, active: next });
      } catch {
        // Keep the current Space; nothing was lost.
      }
    },
    [userId],
  );

  const value = useMemo(
    () => ({ spaces, active, activeId: active?.id ?? null, setActive, activateCreated }),
    [spaces, active, setActive, activateCreated],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useActiveSpace(): ActiveSpaceValue {
  return useContext(Context);
}
