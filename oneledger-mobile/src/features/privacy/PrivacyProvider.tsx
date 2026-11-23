import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { deviceStore } from "@/lib/device-store";

type Preferences = { hidden: boolean; full: boolean };
type PrivacyContextValue = {
  amountsHidden: boolean; fullPrivacy: boolean; saveError: string | null;
  toggleAmountsHidden(): void; setFullPrivacy(next: boolean): void;
};
const PrivacyContext = createContext<PrivacyContextValue>({ amountsHidden: false, fullPrivacy: false, saveError: null, toggleAmountsHidden: () => {}, setFullPrivacy: () => {} });

export function PrivacyProvider({ children, userId }: { children: ReactNode; userId?: string | null }) {
  // Production supplies an explicit user; mask until their setting loads.
  const [loaded, setLoaded] = useState<{ user: string | null | undefined; prefs: Preferences } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const prefs = useMemo(() => loaded && loaded.user === userId ? loaded.prefs : { hidden: userId !== undefined, full: userId !== undefined }, [loaded, userId]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    deviceStore.get(`oneledger.privacy.${userId}`).then((raw) => {
      let next: Preferences = { hidden: false, full: false };
      if (raw) { const stored = JSON.parse(raw); next = { hidden: stored.hidden === true, full: stored.full === true }; }
      if (active) setLoaded({ user: userId, prefs: next });
    }).catch(() => { if (active) setSaveError("Privacy settings could not be loaded. Amounts stay hidden."); });
    return () => { active = false; };
  }, [userId]);
  const save = useCallback((next: Preferences) => {
    setLoaded({ user: userId, prefs: next });
    setSaveError(null);
    if (userId) void deviceStore.set(`oneledger.privacy.${userId}`, JSON.stringify(next)).catch(() => setSaveError("Privacy changed for this session but could not be saved. Try again."));
  }, [userId]);
  const toggleAmountsHidden = useCallback(() => save({ ...prefs, hidden: !prefs.hidden }), [prefs, save]);
  const setFullPrivacy = useCallback((full: boolean) => save({ ...prefs, full }), [prefs, save]);
  const value = useMemo(() => ({ amountsHidden: prefs.hidden || prefs.full, fullPrivacy: prefs.full, toggleAmountsHidden, setFullPrivacy, saveError }), [prefs, toggleAmountsHidden, setFullPrivacy, saveError]);
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}
export function usePrivacy(): PrivacyContextValue { return useContext(PrivacyContext); }
