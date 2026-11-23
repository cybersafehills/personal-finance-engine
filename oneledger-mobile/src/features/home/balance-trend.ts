import { supabase } from "@/api/supabase";
import type { SupportedCurrency } from "@/lib/money";
import { changeBps, homePeriods } from "./live-data";

export type BalanceTrendInput = {
  workspaceId:string|null; accountId:string; currency:SupportedCurrency;
  currentMinor:bigint|null; currentAsOf:string|null; status:string; basis:string|null;
};
export type RecordedBalanceTrend = {
  accountId:string; currentMinor:bigint; currentAsOf:string;
  previousMinor:bigint; previousAsOf:string; deltaBps:number;
};
export function historicalBalanceWindow(asOf:string) {
  const instant=new Date(asOf);
  if (!Number.isFinite(instant.getTime())) return null;
  const period=homePeriods(instant);
  return {to:period.previousTo,from:new Date(Math.max(Date.parse(period.previousFrom),Date.parse(period.previousTo)-7*86400000)).toISOString()};
}
function integer(v:unknown):bigint|null {
  if (typeof v==="number") return Number.isSafeInteger(v) ? BigInt(v) : null;
  return typeof v==="string" && /^-?\d+$/.test(v) ? BigInt(v) : null;
}

/** Two actual provider snapshots, never a reconstructed or manually entered balance. */
export async function loadRecordedBalanceTrend(input:BalanceTrendInput):Promise<RecordedBalanceTrend|null> {
  const {workspaceId,accountId,currency,currentMinor,currentAsOf,status,basis}=input;
  if (!supabase || !workspaceId || !accountId || currentMinor===null || !currentAsOf || status!=="confirmed" || basis!=="provider_reported") return null;
  const window=historicalBalanceWindow(currentAsOf);
  if (!window) return null;
  const {data,error}=await supabase.from("transactions")
    .select("balance_after_rwf, occurred_at, direction, principal_effect_rwf")
    .eq("workspace_id",workspaceId).eq("account_id",accountId).eq("currency",currency)
    .eq("settlement_state","settled").neq("dedupe_state","merged")
    .not("balance_after_rwf","is",null).gte("occurred_at",window.from).lte("occurred_at",window.to)
    .order("occurred_at",{ascending:false}).order("created_at",{ascending:false}).limit(20);
  if (error) throw new Error("Balance comparison unavailable");
  for (const row of data ?? []) {
    const previousMinor=integer(row.balance_after_rwf),principal=integer(row.principal_effect_rwf);
    const previousAsOf=typeof row.occurred_at==="string" ? row.occurred_at : "";
    const time=Date.parse(previousAsOf);
    if (previousMinor===null || !Number.isFinite(time) || time<Date.parse(window.from) || time>Date.parse(window.to)) continue;
    // Same provider-plausibility check as account_balance_baselines_v.
    if (row.direction==="in" && principal!==null && previousMinor<principal) continue;
    if (previousMinor<=0n) return null;
    const deltaBps=changeBps(currentMinor,previousMinor);
    if (deltaBps===null) return null;
    return {accountId,currentMinor,currentAsOf,previousMinor,previousAsOf,deltaBps};
  }
  return null;
}
