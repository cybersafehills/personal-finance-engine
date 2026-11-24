import { createRef, useContext, useEffect, useMemo, useRef, type RefObject } from "react";
import type { ViewInstance } from "react-native";

import { GuideScrollContext } from "@/features/guides/context";

import type { SectionId } from "./story";

export const SECTION_IDS = ["outlook", "pace", "large", "repeat"] as const;
export const isSection = (value: unknown): value is SectionId => typeof value === "string" && (SECTION_IDS as readonly string[]).includes(value);

export type SectionAnchors = Record<SectionId, RefObject<ViewInstance | null>>;

/** One anchor per section: the page attaches them, and Home's rows and the "jump to" chips scroll to them. */
export function useSectionAnchors(): SectionAnchors {
  return useMemo(() => ({ outlook: createRef<ViewInstance>(), pace: createRef<ViewInstance>(), large: createRef<ViewInstance>(), repeat: createRef<ViewInstance>() }), []);
}

/**
 * The scroll-to-an-anchor function belongs to the scroll view, so it can only be read by a component
 * rendered INSIDE the screen (the page component that renders <Screen> itself sits outside it and would
 * get nothing). Use this from children of <Screen>.
 */
export function useJumpToSection(anchors: SectionAnchors): (id: SectionId) => void {
  const reveal = useContext(GuideScrollContext);
  return useMemo(() => (id: SectionId) => reveal?.(anchors[id]), [reveal, anchors]);
}

/**
 * Deep link: when the page was opened for one section ("2 payments much bigger than usual" on Home),
 * scroll there once. Waits until the data is in (sections appear and reorder as answers arrive, and
 * would move the target after an early scroll), and only if that section exists. Renders nothing.
 */
export function ScrollToSection({ section, ready, available, anchors }: { section: unknown; ready: boolean; available: readonly SectionId[]; anchors: SectionAnchors }) {
  const jump = useJumpToSection(anchors);
  const done = useRef(false);
  const exists = isSection(section) && available.includes(section);
  useEffect(() => {
    if (done.current || !ready || !exists) return;
    // A short wait lets the sections finish laying out; `done` is only set when the jump really happens.
    const timer = setTimeout(() => { done.current = true; jump(section as SectionId); }, 150);
    return () => clearTimeout(timer);
  }, [ready, exists, section, jump]);
  return null;
}
