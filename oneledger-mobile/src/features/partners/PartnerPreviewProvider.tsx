import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "@/features/auth/SessionProvider";
import { kigaliDateKey } from "@/lib/kigali-time";
import { EMPTY_FEED, PREVIEW_OFFERS, initialPartnerPreview, sevenDaysAfter, type PartnerFeed, type PartnerPreviewState } from "./model";
import { fetchPartnerFeed } from "./feed";
import { DEFAULT_PREVIEW, PartnerPreviewContext } from "./context";

export { usePartnerPreview } from "./context";

/**
 * Two sources of sponsored content, never mixed:
 *  - preview: fictional offers, development builds only, started explicitly from the design preview
 *  - live: offers the platform owner approved, delivered only while the owner's delivery switch is on
 * Nothing about the user is sent; the user's own choices (hide a brand, turn off Home, interests) stay on the device.
 */
export function PartnerPreviewProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const owner = session?.user.id ?? null;
  const [snapshot, setSnapshot] = useState(() => ({ owner, state: initialPartnerPreview() }));
  const current = snapshot.owner === owner ? snapshot.state : DEFAULT_PREVIEW;
  const [loadedFeed, setFeed] = useState<PartnerFeed>(EMPTY_FEED);
  const feed = owner ? loadedFeed : EMPTY_FEED;
  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    const load = () => { void fetchPartnerFeed().then(next => { if (!cancelled) setFeed(next); }); };
    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [owner]);
  const previewOn = __DEV__ && current.enabled;
  const live = !previewOn && feed.enabled && feed.offers.length > 0;
  const mode: "preview" | "live" | "off" = previewOn ? "preview" : live ? "live" : "off";
  const state = useMemo(() => previewOn ? current : live ? { ...current, enabled: true, placements: feed.placements, scenario: "returning" as const } : DEFAULT_PREVIEW, [previewOn, live, current, feed.placements]);
  const catalog = previewOn ? PREVIEW_OFFERS : live ? feed.offers : [];
  const today = kigaliDateKey(new Date().toISOString());
  const change = useCallback((apply: (previous: PartnerPreviewState) => PartnerPreviewState) => {
    setSnapshot(previous => ({ owner, state: apply(previous.owner === owner ? previous.state : initialPartnerPreview()) }));
  }, [owner]);
  const start = useCallback(() => { if (__DEV__) change(previous => ({ ...previous, enabled: true })); }, [change]);
  const stop = useCallback(() => change(() => initialPartnerPreview()), [change]);
  const reset = useCallback(() => change(() => ({ ...initialPartnerPreview(), enabled: true })), [change]);
  const update = useCallback((patch: Partial<Omit<PartnerPreviewState, "enabled">>) => change(previous => ({ ...previous, ...patch })), [change]);
  const dismissHome = useCallback(() => change(previous => ({ ...previous, dismissedUntil: sevenDaysAfter(today) })), [change, today]);
  const hideBrand = useCallback((id: string) => change(previous => ({ ...previous, hiddenBrands: [...new Set([...previous.hiddenBrands, id])] })), [change]);
  const unhideBrand = useCallback((id: string) => change(previous => ({ ...previous, hiddenBrands: previous.hiddenBrands.filter(brand => brand !== id) })), [change]);
  const value = useMemo(() => ({ state, today, mode, catalog, start, stop, reset, update, dismissHome, hideBrand, unhideBrand }), [state, today, mode, catalog, start, stop, reset, update, dismissHome, hideBrand, unhideBrand]);
  return <PartnerPreviewContext.Provider value={value}>{children}</PartnerPreviewContext.Provider>;
}
