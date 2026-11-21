import { useCallback } from "react";
import { Text } from "@/components/ds";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import type { Wallet } from "@/features/wallets/types";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { loadRecordedBalanceTrend } from "./balance-trend";
import { percentText } from "./live-data";

export function BalanceTrend({wallet,hidden}:{wallet:Wallet;hidden:boolean}) {
  const {activeId}=useActiveSpace();
  const {id,currency,balance:{amountMinor,asOf,status,basis}}=wallet;
  const load=useCallback(()=>loadRecordedBalanceTrend({workspaceId:activeId,accountId:id,currency,currentMinor:amountMinor,currentAsOf:asOf,status,basis}),[activeId,id,currency,amountMinor,asOf,status,basis]);
  const query=useQuery(load,{refreshIntervalMs:60000});
  const eligible=status==="confirmed" && basis==="provider_reported";
  const trend=eligible && !query.error && query.data?.accountId===id && query.data.currentMinor===amountMinor && query.data.currentAsOf===asOf ? query.data : null;
  return <Text variant="caption" color="onSolid" style={{opacity:0.92,fontSize:11,lineHeight:15}}>{hidden ? "Comparison hidden" : trend ? `${trend.deltaBps>0 ? "↗ " : trend.deltaBps<0 ? "↘ " : ""}${percentText(trend.deltaBps)} vs ${formatDateTime(trend.previousAsOf).split(",")[0]} recorded balance` : query.loading && eligible ? "Loading balance trend…" : query.error ? "Balance trend unavailable" : eligible ? "No comparable balance last month" : "Balance comparison unavailable"}</Text>;
}
