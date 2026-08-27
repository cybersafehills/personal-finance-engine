"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { PayLauncher } from "./PayLauncher";

type PayContextValue = {
  enabled: boolean;
  /** Assisted Quick Pay (Phase 2a) is on - the launcher's payment
   *  actions are live rather than "coming later". */
  assistedEnabled: boolean;
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
  children,
}: {
  enabled: boolean;
  assistedEnabled: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const openPay = useCallback(() => {
    if (enabled) setOpen(true);
  }, [enabled]);

  const closePay = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ enabled, assistedEnabled, open, openPay, closePay }),
    [enabled, assistedEnabled, open, openPay, closePay],
  );

  return (
    <PayContext.Provider value={value}>
      {children}
      {enabled && (
        <PayLauncher open={open} onClose={closePay} assistedEnabled={assistedEnabled} />
      )}
    </PayContext.Provider>
  );
}
