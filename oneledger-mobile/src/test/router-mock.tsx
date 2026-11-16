// A minimal stand-in for expo-router in screen tests. Screens use `router`
// for navigation, `useLocalSearchParams` for route params and `useFocusEffect`
// (via useQuery) to load when shown. Tests set params with setParams() and
// assert navigation on the exported `router` mocks.

import { useEffect } from "react";

export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  /** Go to a route (a tab, say) rather than stacking another copy of it. */
  navigate: jest.fn(),
  /** Update the CURRENT route's params; `undefined` removes one. (Distinct from the setParams() helper below, which sets what useLocalSearchParams returns.) */
  setParams: jest.fn(),
};

let params: Record<string, string> = {};
export function setParams(next: Record<string, string>) {
  params = next;
}
export function resetRouterMock() {
  params = {};
  router.push.mockReset();
  router.replace.mockReset();
  router.back.mockReset();
  router.navigate.mockReset();
  router.setParams.mockReset();
}

export function useLocalSearchParams() {
  return params;
}

/**
 * Runs the effect when the screen mounts and whenever the callback changes,
 * like expo-router (callers must memoise it with useCallback).
 */
export function useFocusEffect(effect: () => void | (() => void)) {
  useEffect(effect, [effect]);
}
