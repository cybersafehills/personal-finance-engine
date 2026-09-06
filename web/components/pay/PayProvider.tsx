"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { PayLauncher } from "./PayLauncher";
import {
  getLauncherSnapshot,
  type LauncherSnapshot,
} from "../../app/pay/actions";

type PayContextValue = {
  enabled: boolean;
  /** Assisted Quick Pay (Phase 2a) is on - the launcher's payment
   *  actions are live rather than "coming later". */
  assistedEnabled: boolean;
  /** Scan to pay (Phase R1) is on - the launcher shows the "Scan to pay"
   *  entry and its camera scanner. */
  scanEnabled: boolean;
  open: boolean;
  openPay: () => void;
  closePay: () => void;
};

const PayContext = createContext<PayContextValue | null>(null);

export function usePay(): PayContextValue {
  const ctx = useContext(PayContext);
  if (!ctx) {
    // Rendered outside the provider (e.g. an auth page) - Pay is simply
    // unavailable there.
    return {
      enabled: false,
      assistedEnabled: false,
      scanEnabled: false,
      open: false,
      openPay: () => {},
      closePay: () => {},
    };
  }
  return ctx;
}

/**
 * Single owner of the Pay launcher's open state, mounted once in the
 * authenticated app shell. Both the desktop header trigger and the
 * mobile elevated centre trigger call openPay() through context, so
 * there is never a second launcher instance or a second piece of state
 * to keep in sync.
 */
export function PayProvider({
  enabled,
  assistedEnabled,
  scanEnabled,
  children,
}: {
  enabled: boolean;
  assistedEnabled: boolean;
  scanEnabled: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // The favourites snapshot is kicked off from the SAME gesture that
  // opens the launcher (not from an effect after the panel has mounted),
  // so the starred line is in flight while the sheet animates in rather
  // than popping in a beat later. `null` renders nothing - never a
  // flash of an empty "Favourites" heading.
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null);

  const openPay = useCallback(() => {
    if (!enabled) return;
    setOpen(true);
    getLauncherSnapshot()
      .then(setSnapshot)
      .catch(() => setSnapshot({ favourites: [] }));
  }, [enabled]);

  const closePay = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ enabled, assistedEnabled, scanEnabled, open, openPay, closePay }),
    [enabled, assistedEnabled, scanEnabled, open, openPay, closePay],
  );

  return (
    <PayContext.Provider value={value}>
      {children}
      {enabled && (
        <PayLauncher
          open={open}
          onClose={closePay}
          assistedEnabled={assistedEnabled}
          scanEnabled={scanEnabled}
          snapshot={snapshot}
        />
      )}
    </PayContext.Provider>
  );
}
