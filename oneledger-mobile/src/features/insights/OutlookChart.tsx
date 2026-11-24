import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import { Text } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/ThemeProvider";

import { buildOutlookChart } from "./chart";
import type { WalletForecast } from "./forecast";
import { formatPlain, outlookSeries } from "./story";

/**
 * Your balance over the next few days, as two lines anyone can read: what happens if money comes in as
 * usual, and the cautious case where nothing new arrives. The "Zero" line is where the money is gone; a
 * dot marks the day it runs out. Every figure is also written out in words next to the chart, so the
 * picture is never the only source, and it is hidden together with the amounts.
 */
export function OutlookChart({ wallet, days, runsOutInDays }: { wallet: WalletForecast; days: number; runsOutInDays: number | null }) {
  const { colors } = useTheme();
  const { amountsHidden, fullPrivacy } = usePrivacy();
  const model = useMemo(() => buildOutlookChart(outlookSeries(wallet), days, runsOutInDays), [wallet, days, runsOutInDays]);
  if (!model) return null;
  if (amountsHidden || fullPrivacy) return <Text variant="caption" color="textMuted">The chart is hidden while amounts are hidden.</Text>;
  const description =
    `Your balance over the next ${days} days. With usual income it ends near ${formatPlain(wallet.estimatedEnd)}` +
    `${wallet.estimatedEnd < 0n ? " below zero" : ""}; if nothing new comes in, near ${formatPlain(wallet.noIncomeEnd)}${wallet.noIncomeEnd < 0n ? " below zero" : ""}.` +
    (runsOutInDays !== null ? ` The money runs out in about ${Math.max(0, runsOutInDays)} days.` : "");
  const distinct = wallet.estimatesIncome && !model.sameLines;
  return (
    <View style={{ gap: space[2] }}>
      <Svg viewBox={`0 0 ${model.width} ${model.height}`} width="100%" height={170} accessibilityRole="image" accessibilityLabel={description}>
        {model.zeroY !== null ? (
          <>
            <Line x1={8} x2={model.width - 8} y1={model.zeroY} y2={model.zeroY} stroke={colors.attention} strokeWidth={1.2} strokeDasharray="4 3" />
            <SvgText x={model.width - 8} y={model.zeroY - 4} fontSize={10} fill={colors.attention} textAnchor="end">Zero: money gone</SvgText>
          </>
        ) : null}
        {distinct ? <Path d={model.cautiousPath} stroke={colors.textMuted} strokeWidth={2} fill="none" strokeDasharray="5 4" strokeLinejoin="round" /> : null}
        <Path d={model.expectedPath} stroke={colors.accent} strokeWidth={2.8} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {model.runsOut ? <Circle cx={model.runsOut.x} cy={model.runsOut.y} r={5} fill={colors.attention} stroke={colors.surface} strokeWidth={2} /> : null}
        {model.ticks.map((tick, i) => (
          <SvgText key={tick.day} x={tick.x} y={model.height - 6} fontSize={10} fill={colors.textMuted} textAnchor={i === 0 ? "start" : i === model.ticks.length - 1 ? "end" : "middle"}>
            {tick.day === 0 ? "Today" : `In ${tick.day} days`}
          </SvgText>
        ))}
      </Svg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space[4], rowGap: space[1] }}>
        <Text variant="caption" color="textMuted"><Text variant="caption" style={{ color: colors.accent }}>━ </Text>{wallet.estimatesIncome ? "If money comes in as usual" : "At your recent pace"}</Text>
        {distinct ? <Text variant="caption" color="textMuted"><Text variant="caption" style={{ color: colors.textMuted }}>╍ </Text>If nothing new comes in</Text> : null}
        {model.runsOut ? <Text variant="caption" color="textMuted"><Text variant="caption" style={{ color: colors.attention }}>● </Text>Money runs out</Text> : null}
      </View>
    </View>
  );
}
