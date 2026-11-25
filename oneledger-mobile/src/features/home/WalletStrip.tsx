import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";

import { Text } from "@/components/ds";
import { GuideAnchor } from "@/features/guides/GuideAnchor";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { STATUS_LABEL } from "@/features/wallets/display";
import type { Wallet } from "@/features/wallets/types";
import { formatMoney } from "@/lib/money";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The wallets under the balance card: each with its own balance and what that
 * balance rests on, never added together. Tapping one shows it on the card;
 * the last tile opens all wallets.
 */
export function WalletStrip({ wallets, selectedIndex, onSelect }: { wallets: Wallet[]; selectedIndex: number; onSelect(index: number): void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { amountsHidden } = usePrivacy();
  const strip = useRef<ScrollViewInstance>(null);
  const offsets = useRef<number[]>([]);

  // Swiping the card brings its tile into view.
  useEffect(() => {
    const x = offsets.current[selectedIndex];
    if (x !== undefined) strip.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  }, [selectedIndex]);

  return <ScrollView testID="wallet-strip" ref={strip} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
    {wallets.map((w, i) => {
      const selected = i === selectedIndex;
      const amount = w.balance.amountMinor === null ? "—" : formatMoney(w.balance.amountMinor, w.currency);
      const spoken = amountsHidden ? "amount hidden" : w.balance.amountMinor === null ? "no balance yet" : amount;
      return <Pressable
        key={w.id}
        accessibilityRole="button"
        accessibilityLabel={`Show ${w.name}, ${spoken}, ${STATUS_LABEL[w.balance.status]}`}
        accessibilityState={{ selected }}
        onLayout={({ nativeEvent: { layout } }) => { offsets.current[i] = layout.x; }}
        onPress={() => onSelect(i)}
        style={[styles.tile, selected && styles.selected]}
      >
        <Text variant="label" numberOfLines={1}>{w.name}</Text>
        <Text variant="bodyStrong" tabular numberOfLines={1}>{amountsHidden ? "••••••" : amount}</Text>
        <Text variant="caption" color="textMuted" numberOfLines={1}>{STATUS_LABEL[w.balance.status]}</Text>
      </Pressable>;
    })}
    <GuideAnchor id="home-wallets-manage" style={styles.anchor}>
      <Pressable accessibilityRole="button" accessibilityLabel="All wallets" onPress={() => router.push("/wallets")} style={[styles.tile, styles.all]}>
        <View style={styles.allRow}><Text variant="label" color="accent">All wallets</Text><Feather name="arrow-right" size={14} color={colors.accent} /></View>
      </Pressable>
    </GuideAnchor>
  </ScrollView>;
}

const useStyles = makeStyles((c) => StyleSheet.create({
  row: { gap: 8, paddingVertical: 2, paddingHorizontal: 1 },
  tile: { minWidth: 136, maxWidth: 200, minHeight: 76, padding: 12, gap: 3, borderRadius: 14, borderWidth: 1.5, borderColor: c.borderSubtle, backgroundColor: c.surface },
  selected: { borderColor: c.accent },
  anchor: { alignSelf: "stretch" },
  all: { flex: 1, minWidth: 112, justifyContent: "center", alignItems: "center" },
  allRow: { flexDirection: "row", alignItems: "center", gap: 4 },
}));
