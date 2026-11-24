import { useContext } from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { useNavigationChrome } from "./NavigationChromeContext";

/** The dock pill (64) plus the 8 above it. */
export const DOCK_BODY = 72;
/** Space between the dock and the screen's bottom edge: it sits just above the home indicator, never lower than 8. */
export const dockBottomGap = (bottomInset: number) => Math.max(bottomInset - 18, 8);
/** The Pay button grows by this much while it sits in the middle of the dock. */
export const PAY_CENTRE_SCALE = 56 / 48;

/**
 * Extra bottom padding a tab screen's scrolling content needs so its last item can scroll
 * clear of the floating dock. The dock never reserves layout space: content scrolls behind
 * and is seen through the glass. Zero off the tabs.
 */
export function useDockClearance(): number {
  const { onTabs } = useNavigationChrome();
  // The context (not the hook) so a screen rendered without a provider still works.
  const insets = useContext(SafeAreaInsetsContext);
  return onTabs ? DOCK_BODY + dockBottomGap(insets?.bottom ?? 0) + 12 : 0;
}
