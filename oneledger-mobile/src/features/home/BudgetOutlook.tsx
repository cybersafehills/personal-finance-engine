import { router } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Badge, Card, Text } from "@/components/ds";
import { useTheme } from "@/theme/ThemeProvider";
import type { BudgetsResult } from "@/features/budgets/parse";
import { totals, worstStatus } from "@/features/budgets/display";
import { homeStatus, daysRemaining, daysLeftLabel } from "./display";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { compactMoney } from "./live-data";
import { kigaliDateKey } from "@/lib/kigali-time";
import type { SupportedCurrency } from "@/lib/money";

export function BudgetOutlook({ result, currency, now, error }: { result: BudgetsResult | null; currency: SupportedCurrency; now: Date; error: string | null }) {
  const { amountsHidden } = usePrivacy();
  const { colors } = useTheme();
  const day = kigaliDateKey(now.toISOString());
  const budgets = result?.ok ? result.budgets.filter(b => b.currency === currency && b.periodStart <= day && b.periodEnd >= day).sort((a,b) => b.periodStart.localeCompare(a.periodStart) || a.id.localeCompare(b.id)) : [];
  const budget = budgets[0];
  const sum = budget ? totals(budget.allocations) : null;
  const status = budget ? homeStatus(worstStatus(budget.allocations)) : null;
  const projected = budget?.allocations.length && budget.allocations.every(a => a.projectedMinor !== null) ? budget.allocations.reduce((s,a) => s + a.projectedMinor!,0) : null;
  const money = (n: number) => amountsHidden ? "••••••" : Number.isSafeInteger(n) ? compactMoney(BigInt(n),currency) : "Unavailable";
  const percent = sum && sum.percentUsed !== null ? Math.round(sum.percentUsed) : null;
  const fraction = amountsHidden || percent === null ? 0 : Math.max(0, Math.min(1, percent / 100));
  const empty = result && !result.ok ? result.message : result ? `No active ${currency} budget. Set one up in Plan.` : error ? "Budget unavailable. Try again in Plan." : "Loading your budget…";
  const title = budget ? `${budget.name}${amountsHidden || percent === null ? "" : ` · ${percent}% used`}` : "Budget";
  const days = budget ? daysLeftLabel(daysRemaining(budget.periodEnd, now.toISOString())) : null;
  const unmapped = Boolean(budget && budget.uncategorizedCount + budget.unmappedCount > 0);
  // The whole card is one button, so its label has to say everything the card shows.
  const spoken = [
    error ? "Couldn’t refresh your budget" : null,
    title,
    ...(budget && sum && status ? [
      status.label,
      days,
      amountsHidden ? "Amounts hidden" : `Remaining ${money(sum.remainingMinor)}`,
      amountsHidden ? null : `Projected at period end ${projected === null ? "Not enough data" : money(projected)}`,
      budgets.length > 1 ? `${budgets.length} active plans` : null,
      unmapped ? "Some transactions still need a budget category" : null,
    ] : [empty]),
    "View plan",
  ].filter(Boolean).join(". ");
  return <Pressable accessibilityRole="button" accessibilityLabel={spoken} onPress={() => router.navigate("/plan")}>
    <Card style={styles.card}>
      <Svg width={44} height={44} viewBox="0 0 44 44" accessible={false}>
        <Circle cx={22} cy={22} r={18} fill="none" stroke={colors.borderSubtle} strokeWidth={6} />
        {fraction > 0 ? <Circle cx={22} cy={22} r={18} fill="none" stroke={colors.accent} strokeWidth={6} strokeDasharray={`${fraction * RING} ${RING}`} transform="rotate(-90 22 22)" /> : null}
      </Svg>
      <View style={styles.copy}>
        {error ? <Text variant="caption" color="attention">Couldn’t refresh your budget.</Text> : null}
        {budget && sum && status ? <>
          <Text variant="bodyStrong" numberOfLines={2}>{title}</Text>
          <View style={styles.line}><Badge variant={status.variant}>{status.label}</Badge><Text variant="caption" color="textMuted">{days}</Text></View>
          <View style={styles.line}><Text variant="caption" color="textMuted">Remaining</Text><Text variant="caption" tabular>{money(sum.remainingMinor)}</Text></View>
          <View style={styles.line}><Text variant="caption" color="textMuted">Projected at period end</Text><Text variant="caption" tabular>{projected === null ? "Not enough data" : money(projected)}</Text></View>
          {budgets.length > 1 ? <Text variant="caption" color="textMuted">{budgets.length} active plans</Text> : null}
          {unmapped ? <Text variant="caption" color="attention">Some transactions still need a budget category.</Text> : null}
        </> : <><Text variant="bodyStrong">Budget</Text><Text variant="caption" color="textMuted">{empty}</Text></>}
      </View>
      <Feather name="chevron-right" size={18} color={colors.textMuted} />
    </Card>
  </Pressable>;
}
const RING = 2 * Math.PI * 18;
const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 14 },
  copy: { flex: 1, gap: 2 },
  line: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
});
