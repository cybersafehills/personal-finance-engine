import { useId } from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { Text } from "@/components/ds";
import type { CurrencyOverview } from "@/features/insights/types";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { compactMoney } from "./live-data";
import { useTheme } from "@/theme/ThemeProvider";
import type { SupportedCurrency } from "@/lib/money";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export type TrendPoint = NonNullable<CurrencyOverview["trend"]>[number];

export function TrendChart({ points, currency, granularity="month" }: { points: TrendPoint[]; currency: SupportedCurrency; granularity?:"day"|"week"|"month" }) {
  const { colors } = useTheme();
  const { amountsHidden } = usePrivacy();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (amountsHidden) return <View style={{ minHeight: 160, justifyContent: "center", alignItems: "center" }}><Text color="textMuted">Amounts hidden</Text></View>;
  if (!points.length) return <Text color="textMuted" style={{ paddingVertical: 32 }}>Your trend appears when there is transaction history.</Text>;
  const vals = points.flatMap((p) => [Number(p.moneyInMinor), Number(p.moneyOutMinor)]);
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
  const x = (i: number) => points.length === 1 ? 172 : 38 + i * 268 / (points.length - 1);
  const y = (v: number) => 16 + (hi - v) * 115 / (hi - lo);
  const line = (key: "moneyInMinor" | "moneyOutMinor") => points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(Number(p[key]))}`).join(" ");
  return <View>
    <Svg viewBox="0 0 316 162" width="100%" height={148} accessibilityRole="image" accessibilityLabel={points.map((p) => `${p.bucketStart}: income ${compactMoney(p.moneyInMinor, currency)}, expenses ${compactMoney(p.moneyOutMinor, currency)}`).join("; ")}>
      <Defs><LinearGradient id={id} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={colors.chartIncome} stopOpacity={0.18} /><Stop offset="1" stopColor={colors.chartIncome} stopOpacity={0} /></LinearGradient></Defs>
      {[lo, (lo + hi) / 2, hi].map((v, i) => <ViewlessGrid key={i} value={v} y={y(v)} currency={currency} />)}
      <Path d={`${line("moneyInMinor")} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${id})`} />
      <Path d={line("moneyInMinor")} stroke={colors.chartIncome} strokeWidth={2.6} fill="none" />
      <Path d={line("moneyOutMinor")} stroke={colors.chartExpense} strokeWidth={2.6} fill="none" />
      {points.map((p, i) => i===0||i===points.length-1||i%Math.ceil(points.length/5)===0 ? <SvgText key={p.bucketStart} x={x(i)} y={153} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize={10} fill={colors.textMuted}>{MONTHS[Number(p.bucketStart.slice(5, 7)) - 1]}{granularity!=="month"?` ${Number(p.bucketStart.slice(8,10))}`:""}</SvgText>:null)}
      {points.length === 1 ? <><Circle cx={x(0)} cy={y(Number(points[0].moneyInMinor))} r={3} fill={colors.chartIncome} /><Circle cx={x(0)} cy={y(Number(points[0].moneyOutMinor))} r={3} fill={colors.chartExpense} /></> : null}
    </Svg>
    <View style={{ flexDirection: "row", gap: 20, marginTop: 6 }}>
      <Text variant="caption" color="textMuted"><Text style={{ color: colors.chartIncome }}>● </Text>Income</Text>
      <Text variant="caption" color="textMuted"><Text style={{ color: colors.chartExpense }}>● </Text>Expenses</Text>
    </View>
  </View>;
}
function ViewlessGrid({ value, y, currency }: { value: number; y: number; currency: SupportedCurrency }) {
  const { colors } = useTheme();
  const text = compactMoney(BigInt(Math.trunc(value)), currency).replace(`${currency} `, "");
  return <><Line x1={38} x2={306} y1={y} y2={y} stroke={colors.borderSubtle} /><SvgText x={0} y={y + 3} fontSize={8} fill={colors.textMuted}>{text}</SvgText></>;
}
export function Donut({ slices, total }: { slices: { amount: bigint; color: string }[]; total: React.ReactNode }) {
  const sum = slices.reduce((s, p) => s + p.amount, 0n);
  const c = 2 * Math.PI * 49;
  return <View style={{ width: 126, height: 126, justifyContent: "center", alignItems: "center" }}>
    <Svg viewBox="0 0 126 126" width={126} height={126} style={{ position: "absolute" }} accessible={false}>
      {slices.map((p, i) => {
        const length = sum > 0n ? Number(p.amount * 100000n / sum) / 100000 * c : 0;
        const before = slices.slice(0, i).reduce((s, p) => s + p.amount, 0n);
        const start = sum > 0n ? Number(before * 100000n / sum) / 100000 * c : 0;
        return <Circle key={i} cx={63} cy={63} r={49} fill="none" stroke={p.color} strokeWidth={17} strokeDasharray={`${length} ${c - length}`} strokeDashoffset={-start} rotation={-90} origin="63,63" />;
      })}
    </Svg>
    {total}
  </View>;
}
