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
    return { enabled: false, open: false, openPay: () => {}, closePay: () => {} };
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
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const openPay = useCallback(() => {
    if (enabled) setOpen(true);
  }, [enabled]);

  const closePay = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ enabled, open, openPay, closePay }),
    [enabled, open, openPay, closePay],
  );

  return (
    <PayContext.Provider value={value}>
      {children}
      {enabled && <PayLauncher open={open} onClose={closePay} />}
    </PayContext.Provider>
  );
}
