import { useCallback } from "react";

import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { useQuery } from "@/hooks/useQuery";

import { fetchForecast, type WalletForecast } from "./forecast";
import { fetchIntelligence, notifyInsightChange, type Intelligence } from "./intelligence";

export const OUTLOOK_DAYS = 30;

export type OutlookData = {
  facts: Intelligence | null;
  /** The default wallet's forecast (what Home shows). */
  wallet: WalletForecast | null;
  computedAt: string | null;
  /** Why nothing loaded (shown in preview builds only). */
  failure: string | null;
};

/**
 * Everything Home's outlook card and the Cash flow block need, loaded ONCE. Facts first: when the
 * feature is off for this Space the first call answers "unavailable" and nothing else is requested;
 * the forecast is then best-effort. `enabled` false (another currency selected) requests nothing.
 */
export function useOutlookData(enabled: boolean): { data: OutlookData | null; error: string | null } {
  const { activeId: workspaceId } = useActiveSpace();
  const load = useCallback(async (): Promise<OutlookData | null> => {
    if (!workspaceId || !enabled) return null;
    const facts = await fetchIntelligence(workspaceId);
    if (!facts.ok) return { facts: null, wallet: null, computedAt: null, failure: `${facts.reason}: ${facts.message}` };
    const forecast = await fetchForecast({ workspaceId, accountId: null, days: OUTLOOK_DAYS });
    // Fire and forget: a new "forecast updated" notification shows up in the Inbox on its next load.
    void notifyInsightChange(workspaceId);
    const wallets = forecast.ok ? forecast.wallets : [];
    const wallet = wallets.find((w) => w.id === facts.defaultWalletId) ?? wallets[0] ?? null;
    return { facts, wallet, computedAt: forecast.ok ? forecast.computedAt : facts.computedAt, failure: null };
  }, [workspaceId, enabled]);
  const { data, error } = useQuery(load, `${workspaceId ?? "none"}|${enabled}`);
  return { data, error };
}
