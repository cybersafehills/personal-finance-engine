import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import type { SupportedCurrency } from "@/lib/money";
import { makeStyles } from "@/theme/ThemeProvider";

import type { TrendPoint } from "./Charts";
import { compactMoney } from "./live-data";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEIGHT = 96;

/**
 * Money in and money out for each of the last months, as paired bars. Tapping a
 * month spells its figures out underneath (the newest is chosen to start with),
 * so nothing depends on reading bar heights or telling two colours apart.
 * `points` are the server's monthly buckets; the last one is still running.
 */
export function MonthlyBars({ points, currency, message }: { points: TrendPoint[] | null; currency: SupportedCurrency; message: string }) {
  const styles = useStyles();
  const { amountsHidden } = usePrivacy();
  const [chosen, setChosen] = useState<string | null>(null);

  if (amountsHidden) return <Text variant="caption" color="textMuted">Monthly chart hidden with amounts.</Text>;
  if (!points) return <Text variant="caption" color="textMuted">{message}</Text>;
  if (points.every((p) => p.moneyInMinor === 0n && p.moneyOutMinor === 0n)) return <Text variant="caption" color="textMuted">No money in or out recorded in these months.</Text>;

  const top = points.reduce((m, p) => [m, p.moneyInMinor, p.moneyOutMinor].reduce((a, b) => (b > a ? b : a)), 1n);
  // Net refunds can make a month negative: no bar, but the figure is still spelled out.
  const height = (value: bigint) => (value > 0n ? Math.max(3, Number((value * BigInt(HEIGHT)) / top)) : 0);
  const month = (p: TrendPoint) => MONTHS[Number(p.bucketStart.slice(5, 7)) - 1];
  const current = points[points.length - 1];
  const selected = points.find((p) => p.bucketStart === chosen) ?? current;
  const running = (p: TrendPoint) => (p === current ? " so far" : "");
  const figures = (p: TrendPoint) => `money in ${compactMoney(p.moneyInMinor, currency)}, money out ${compactMoney(p.moneyOutMinor, currency)}`;

  return <View testID="monthly-bars" style={styles.chart}>
    <View style={styles.columns}>
      {points.map((p) => <Pressable
        key={p.bucketStart}
        accessibilityRole="button"
        accessibilityLabel={`${month(p)}${running(p)}: ${figures(p)}`}
        accessibilityState={{ selected: p === selected }}
        onPress={() => setChosen(p.bucketStart)}
        style={[styles.column, p === selected && styles.chosen]}
      >
        <View style={styles.bars}>
          <View style={[styles.bar, styles.barIn, { height: height(p.moneyInMinor) }]} />
          <View style={[styles.bar, styles.barOut, { height: height(p.moneyOutMinor) }]} />
        </View>
        <Text variant="caption" color={p === selected ? "textPrimary" : "textMuted"} numberOfLines={1}>{month(p)}</Text>
      </Pressable>)}
    </View>
    <View style={styles.legend}>
      <View style={styles.key}><View style={[styles.swatch, styles.barIn]} /><Text variant="caption" color="textMuted">Money in</Text></View>
      <View style={styles.key}><View style={[styles.swatch, styles.barOut]} /><Text variant="caption" color="textMuted">Money out</Text></View>
    </View>
    <Text variant="caption" accessibilityLiveRegion="polite">{`${month(selected)}${running(selected)}: ${figures(selected)}`}</Text>
  </View>;
}

const useStyles = makeStyles((c) => StyleSheet.create({
  chart: { gap: 8, paddingTop: 4 },
  columns: { flexDirection: "row", gap: 4 },
  column: { flex: 1, minHeight: 44, alignItems: "center", gap: 4, paddingVertical: 4, borderRadius: 10 },
  chosen: { backgroundColor: c.background },
  bars: { height: HEIGHT, flexDirection: "row", alignItems: "flex-end", gap: 3 },
  bar: { width: 11, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  barIn: { backgroundColor: c.barIn },
  barOut: { backgroundColor: c.barOut },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  key: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
}));
