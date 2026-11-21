import { router } from "expo-router";
import { View } from "react-native";
import { Badge, ProgressBar, Text } from "@/components/ds";
import type { BudgetsResult } from "@/features/budgets/parse";
import { totals, worstStatus, periodLabel } from "@/features/budgets/display";
import { homeStatus, daysRemaining, daysLeftLabel } from "./display";
import { HomeSection, HomeLink } from "./HomeCards";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { compactMoney } from "./live-data";
import { kigaliDateKey } from "@/lib/kigali-time";
import type { SupportedCurrency } from "@/lib/money";

export function BudgetOutlook({ result, currency, now, error }: { result: BudgetsResult | null; currency: SupportedCurrency; now: Date; error: string | null }) {
  const { amountsHidden } = usePrivacy();
  const day = kigaliDateKey(now.toISOString());
  const budgets = result?.ok ? result.budgets.filter(b => b.currency === currency && b.periodStart <= day && b.periodEnd >= day).sort((a,b) => b.periodStart.localeCompare(a.periodStart) || a.id.localeCompare(b.id)) : [];
  const budget = budgets[0];
  const sum = budget ? totals(budget.allocations) : null;
  const status = budget ? homeStatus(worstStatus(budget.allocations)) : null;
  const projected = budget?.allocations.length && budget.allocations.every(a => a.projectedMinor !== null) ? budget.allocations.reduce((s,a) => s + a.projectedMinor!,0) : null;
  const money = (n: number) => amountsHidden ? "••••••" : Number.isSafeInteger(n) ? compactMoney(BigInt(n),currency) : "Unavailable";
  return <HomeSection title="Budget forecast" subtitle={budget ? `${budget.name} · ${periodLabel(budget.periodStart,budget.periodEnd)}` : "Plan your spending"} action={<HomeLink label="View plan" onPress={() => router.navigate("/plan")} />}>
    {error ? <Text variant="caption" color="attention">Couldn’t refresh your budget.</Text> : null}
    {budget && sum && status ? <>
      <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}}><Badge variant={status.variant}>{status.label}</Badge><Text variant="caption" color="textMuted">{daysLeftLabel(daysRemaining(budget.periodEnd,now.toISOString()))}</Text></View>
      {!amountsHidden ? <ProgressBar label="Budget used" fraction={Math.max(0,Math.min(1,(sum.percentUsed ?? 0)/100))} /> : null}
      <View style={{flexDirection:"row",gap:12}}><View style={{flex:1,gap:4}}><Text variant="caption" color="textMuted">Remaining</Text><Text variant="bodyStrong">{money(sum.remainingMinor)}</Text></View><View style={{flex:1,gap:4}}><Text variant="caption" color="textMuted">Projected at period end</Text><Text variant="bodyStrong">{projected === null ? "Not enough data" : money(projected)}</Text></View></View>
      <Text variant="caption" color="textMuted">{money(sum.actualMinor)} used of {money(sum.targetMinor)}{budgets.length > 1 ? ` · ${budgets.length} active plans` : ""}</Text>
      {budget.uncategorizedCount + budget.unmappedCount > 0 ? <Text variant="caption" color="attention">Some transactions still need a budget category.</Text> : null}
    </> : <Text variant="caption" color="textMuted">{result && !result.ok ? result.message : result ? `No active ${currency} budget. Set one up in Plan.` : error ? "Budget unavailable. Try again in Plan." : "Loading your budget…"}</Text>}
  </HomeSection>;
}
