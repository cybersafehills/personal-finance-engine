import { useCallback } from "react";

import { fetchMoreFlags } from "@/api/mobile-api";
import { useQuery } from "@/hooks/useQuery";

/**
 * Whether the cash-flow forecast is on for the active Space (both server gates:
 * the Insights Center and Intelligence). Only an explicit `true` from the server
 * shows an entry point, so a dark feature never offers a dead link; the screen
 * itself still copes with "unavailable".
 */
export function useForecastEnabled(): boolean {
  const load = useCallback(() => fetchMoreFlags(), []);
  const { data } = useQuery(load);
  return data?.insights === true && data?.insightsCenter === true;
}
