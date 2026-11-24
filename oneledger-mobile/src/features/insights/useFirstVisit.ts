import { useCallback, useEffect, useState } from "react";

import { deviceStore } from "@/lib/device-store";

/**
 * True the first time a screen is opened on this device (so a short "what is this page?" can be
 * shown open), false afterwards. `dismiss` records it. Storage trouble means "not first": a hint
 * is never worth blocking a screen for.
 */
export function useFirstVisit(key: string): { first: boolean; dismiss: () => void } {
  const [first, setFirst] = useState(false);
  useEffect(() => {
    let active = true;
    deviceStore.get(key).then((seen) => { if (active && seen === null) setFirst(true); }).catch(() => {});
    return () => { active = false; };
  }, [key]);
  const dismiss = useCallback(() => {
    setFirst(false);
    void deviceStore.set(key, "1").catch(() => {});
  }, [key]);
  return { first, dismiss };
}
