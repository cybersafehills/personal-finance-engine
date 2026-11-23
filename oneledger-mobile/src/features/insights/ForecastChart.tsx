import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import { Text } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/ThemeProvider";

import { buildChart } from "./chart";
import type { WalletForecast } from "./forecast";

/**
 * The projected balance over the horizon, as on the web: a solid line for the
 * scheduled items only, a dashed one with everyday spending, a dashed zero line
 * when the balance may cross it and a marker at the low point. Text carries
 * every figure too (the picture is never the only source); while amounts are
 * hidden the shape is hidden as well.
 */
export function ForecastChart({ wallet, days }: { wallet: WalletForecast; days: number }) {
  const { colors } = useTheme();
  const { amountsHidden, fullPrivacy } = usePrivacy();
  const model = useMemo(
    () => buildChart(wallet.points.map((p) => ({ day: p.day, scheduled: p.scheduled, estimated: p.estimated })), days, wallet.low),
    [wallet.points, wallet.low, days],
  );
  if (!model) return null;
  if (amountsHidden || fullPrivacy) return <Text variant="caption" color="textMuted">The chart is hidden while amounts are hidden.</Text>;

  const label =
    `Projected balance over ${days} days. Scheduled items only ends near ${formatMoney(wallet.scheduledEnd, "RWF")}; ` +
    `with everyday spending, ${formatMoney(wallet.estimatedEnd, "RWF")}.` +
    (wallet.low ? ` It may fall below zero around day ${wallet.low.day}.` : "");

  return (
    <View style={{ gap: space[1] }}>
      <Svg viewBox={`0 0 ${model.width} ${model.height}`} width="100%" height={150} accessibilityRole="image" accessibilityLabel={label}>
        {model.zeroY !== null ? <Line x1={8} x2={model.width - 8} y1={model.zeroY} y2={model.zeroY} stroke={colors.attention} strokeWidth={1} strokeDasharray="3 3" /> : null}
        <Path d={model.scheduledPath} stroke={colors.accent} strokeWidth={2.4} fill="none" strokeLinejoin="round" />
        <Path d={model.estimatedPath} stroke={colors.textMuted} strokeWidth={2.4} fill="none" strokeDasharray="5 4" strokeLinejoin="round" />
        {model.low ? <Circle cx={model.low.x} cy={model.low.y} r={3.5} fill={colors.attention} /> : null}
        <SvgText x={8} y={model.height - 6} fontSize={10} fill={colors.textMuted}>Today</SvgText>
        <SvgText x={model.width - 8} y={model.height - 6} fontSize={10} fill={colors.textMuted} textAnchor="end">{`Day ${days}`}</SvgText>
      </Svg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space[3], rowGap: space[1] }}>
        <Text variant="caption" color="textMuted"><Text variant="caption" style={{ color: colors.accent }}>━ </Text>Scheduled items only</Text>
        <Text variant="caption" color="textMuted"><Text variant="caption" style={{ color: colors.textMuted }}>╍ </Text>With everyday spending</Text>
        {wallet.low ? <Text variant="caption" color="textMuted"><Text variant="caption" style={{ color: colors.attention }}>● </Text>Lowest point</Text> : null}
      </View>
    </View>
  );
}
