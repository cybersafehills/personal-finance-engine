import { useEffect, useSyncExternalStore } from "react";

import { deviceStore } from "@/lib/device-store";

import { DEFAULT_HOLD_PREFS, normalizeHoldPrefs, type HoldPrefs } from "./hold-action";

// The Pay-button hold setting: kept on this phone (it is a preference about
// this device's thumb, not about the account), read once, then shared between
// the button and its settings screen.

const KEY = "ol.pay-hold.v1";

let prefs: HoldPrefs = DEFAULT_HOLD_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

function emit(next: HoldPrefs) {
  prefs = next;
  listeners.forEach((l) => l());
}

export function getHoldPrefs(): HoldPrefs {
  return prefs;
}

export async function loadHoldPrefs(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await deviceStore.get(KEY);
    if (raw) emit(normalizeHoldPrefs(JSON.parse(raw)));
  } catch {
    // Unreadable or missing: the defaults stand.
  }
}

export async function setHoldPrefs(change: Partial<HoldPrefs>): Promise<void> {
  loaded = true;
  const next = normalizeHoldPrefs({ ...prefs, ...change });
  emit(next);
  try {
    await deviceStore.set(KEY, JSON.stringify(next));
  } catch {
    // Not saved: it still applies until the app closes.
  }
}

/** For tests. */
export function resetHoldPrefs(): void {
  loaded = false;
  prefs = DEFAULT_HOLD_PREFS;
  listeners.clear();
}

export function useHoldPrefs(): HoldPrefs {
  useEffect(() => {
    void loadHoldPrefs();
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getHoldPrefs,
    getHoldPrefs,
  );
}
