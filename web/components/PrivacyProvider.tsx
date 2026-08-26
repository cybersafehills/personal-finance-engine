"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { setHideBalance } from "../app/settings/privacy/actions";

type PrivacyContextValue = {
  /** Mask condition for the Current Balance card specifically: the user's own eye/eye-off preference, OR full privacy mode overriding it. */
  isBalanceMasked: boolean;
  /** Mask condition for every other sensitive dashboard figure (today's totals, budget remaining, dashboard transaction preview) - full privacy mode only, never the standalone balance eye toggle. */
  isDashboardMasked: boolean;
  /** Whether the eye control reflects the user's own toggle or is being forced by privacy mode (used to disable/explain the control rather than let it silently do nothing). */
  balanceHiddenByPrivacyMode: boolean;
  toggleBalanceVisible: () => void;
  isSavingBalanceVisibility: boolean;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

/**
 * Bootstraps from server-rendered preference values (see app/layout.tsx ->
 * getUiPreferences()) so there is zero client fetch and zero flash of an
 * unmasked amount before a preference resolves (master prompt §6.4/§11.1).
 * Only hide_balance gets optimistic client-side state - it is the one
 * value ever toggled from *within* this tree (the balance card's eye
 * icon); privacy_mode is only ever changed from the Settings form, which
 * does a full server round trip and revalidates this layout, so it is
 * read straight from props.
 */
export function PrivacyProvider({
  children,
  initialHideBalance,
  privacyMode,
}: {
  children: React.ReactNode;
  initialHideBalance: boolean;
  privacyMode: boolean;
}) {
  const [hideBalance, setHideBalanceLocal] = useState(initialHideBalance);
  const [isSaving, setIsSaving] = useState(false);
  const lastServerValue = useRef(initialHideBalance);

  // Sync down when the server-provided value changes for a reason outside
  // this toggle (a settings-page revalidation, or the same preference
  // loaded on another device/tab) - never overwrites an in-flight local
  // toggle the user just made.
  useEffect(() => {
    if (initialHideBalance !== lastServerValue.current) {
      lastServerValue.current = initialHideBalance;
      setHideBalanceLocal(initialHideBalance);
    }
  }, [initialHideBalance]);

  const toggleBalanceVisible = useCallback(() => {
    const next = !hideBalance;
    const previous = hideBalance;
    setHideBalanceLocal(next);
    setIsSaving(true);
    setHideBalance(next)
      .then((result) => {
        if (result.ok) {
          lastServerValue.current = next;
        } else {
          // Roll back the optimistic UI - persistence failed, so the
          // control must reflect what is actually saved, not what was
          // clicked (master prompt §5.3/§11.3).
          setHideBalanceLocal(previous);
        }
      })
      .catch(() => {
        setHideBalanceLocal(previous);
      })
      .finally(() => {
        setIsSaving(false);
      });
  }, [hideBalance]);

  const value: PrivacyContextValue = {
    isBalanceMasked: hideBalance || privacyMode,
    isDashboardMasked: privacyMode,
    balanceHiddenByPrivacyMode: privacyMode,
    toggleBalanceVisible,
    isSavingBalanceVisibility: isSaving,
  };

  return (
    <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
  );
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) {
    throw new Error("usePrivacy must be used within a PrivacyProvider");
  }
  return ctx;
}
