import { createContext, useContext, type RefObject } from "react";
import type { ViewInstance } from "react-native";
import type { GuideDefinition } from "./definitions";
import type { GuideId, GuideState } from "./model";
export type Anchor = { measure: (callback: (x: number, y: number, w: number, h: number) => void) => void; reveal?: () => void; follow?: () => void };
export type GuidesContextValue = {
  ready: boolean; state: GuideState; definitions: GuideDefinition[]; active: boolean; notice: string | null;
  register(id: string, entry: Anchor): () => void;
  start(id: GuideId, replay?: boolean): void;
  offerWelcome(): void;
  considerWelcome(): void;
  pause(): void;
  claimSuggestion(id: GuideId): boolean;
  dismissSuggestion(id: GuideId): void;
};
export const GuidesContext = createContext<GuidesContextValue | null>(null);
export const useGuides = () => useContext(GuidesContext);
export const GuideScrollContext = createContext<((target: RefObject<ViewInstance | null>) => void) | undefined>(undefined);
