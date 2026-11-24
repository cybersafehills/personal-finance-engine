import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "@/features/auth/SessionProvider";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { kigaliDateKey } from "@/lib/kigali-time";
import { EMPTY_FEED, PREVIEW_OFFERS, initialPartnerPreview, type PartnerFeed, type PartnerPreviewState, type PlacementId } from "./model";
import { fetchPartnerFeed } from "./feed";
import { DEFAULT_PREVIEW, PartnerPreviewContext } from "./context";

export { usePartnerPreview } from "./context";

/**
 * Two sources of sponsored content, never mixed:
 *  - preview: fictional offers, development builds only, started explicitly from the design preview
 *  - live: offers the platform owner approved, delivered only while the owner's delivery switch is on
 * Nothing about the user is sent; interests and language stay on the device. Adverts cannot be switched off; only Business accounts can dismiss the Home banner, and only for the current session.
 */
export function PartnerPreviewProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const { active } = useActiveSpace();
  const canDismiss = active?.kind === "organization";
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
  const base = useMemo(() => previewOn ? current : live ? { ...current, enabled: true, placements: feed.placements, scenario: "returning" as const } : DEFAULT_PREVIEW, [previewOn, live, current, feed.placements]);
  const state = useMemo(() => (base.dismissed.length && !canDismiss ? { ...base, dismissed: [] } : base), [base, canDismiss]);
  const catalog = previewOn ? PREVIEW_OFFERS : live ? feed.offers : [];
  const today = kigaliDateKey(new Date().toISOString());
  const change = useCallback((apply: (previous: PartnerPreviewState) => PartnerPreviewState) => {
    setSnapshot(previous => ({ owner, state: apply(previous.owner === owner ? previous.state : initialPartnerPreview()) }));
  }, [owner]);
  const start = useCallback(() => { if (__DEV__) change(previous => ({ ...previous, enabled: true })); }, [change]);
  const stop = useCallback(() => change(() => initialPartnerPreview()), [change]);
  const reset = useCallback(() => change(() => ({ ...initialPartnerPreview(), enabled: true })), [change]);
  const update = useCallback((patch: Partial<Omit<PartnerPreviewState, "enabled">>) => change(previous => ({ ...previous, ...patch })), [change]);
  const dismissPlacement = useCallback((id: PlacementId) => { if (canDismiss) change(previous => ({ ...previous, dismissed: [...new Set([...previous.dismissed, id])] })); }, [canDismiss, change]);
  const value = useMemo(() => ({ state, today, mode, catalog, start, stop, reset, update, canDismiss, dismissPlacement }), [state, today, mode, catalog, start, stop, reset, update, canDismiss, dismissPlacement]);
  return <PartnerPreviewContext.Provider value={value}>{children}</PartnerPreviewContext.Provider>;
}
