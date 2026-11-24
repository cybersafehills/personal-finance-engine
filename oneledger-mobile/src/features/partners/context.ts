import { createContext, useContext } from "react";
import { initialPartnerPreview, type PartnerOffer, type PartnerPreviewState } from "./model";

// Kept in its own module that is rarely edited: if hot reload re-evaluated this file next to the
// provider, Home and the provider could end up holding two different contexts and Home would see "off".
export type PreviewContext = {
  state: PartnerPreviewState; today: string;
  /** "preview" = fictional design-review offers (development only); "live" = owner-approved offers from the platform; "off" = nothing. */
  mode: "preview" | "live" | "off";
  /** The offers this mode can show. */
  catalog: readonly PartnerOffer[];
  start(): void; stop(): void; reset(): void;
  update(patch: Partial<Omit<PartnerPreviewState, "enabled">>): void;
  /** Only Business accounts may dismiss a banner, and only for the current session. */
  canDismiss: boolean;
  dismissHome(): void;
};
export const DEFAULT_PREVIEW = initialPartnerPreview();
const noop = () => {};
export const PartnerPreviewContext = createContext<PreviewContext>({ state: DEFAULT_PREVIEW, today: "", mode: "off", catalog: [], start: noop, stop: noop, reset: noop, update: noop, canDismiss: false, dismissHome: noop });
export const usePartnerPreview = () => useContext(PartnerPreviewContext);
