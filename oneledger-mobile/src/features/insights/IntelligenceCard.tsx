import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { HomeLink, HomeSection } from "@/features/home/HomeCards";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { useQuery } from "@/hooks/useQuery";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { space } from "@/theme/tokens";

import { fetchForecast, type WalletForecast } from "./forecast";
import { fetchIntelligence, notifyInsightChange } from "./intelligence";
import { OutlookCard } from "./OutlookCard";
import { outlookFor, summaryRows } from "./story";

const HORIZON = 30;

/**
 * Home's money outlook: ONE verdict ("You're on track" / "Your money may run out in about 2 days")
 * and at most four one-line rows, however much activity the account has. Every row opens the full
 * outlook page, which holds the detail. Each part loads on its own, and the whole card stays out of
 * the way (renders nothing) when the feature is off for this Space or there is nothing to say - Home
 * never waits on it or breaks because of it.
 */
export function IntelligenceCard() {
  const { amountsHidden, fullPrivacy } = usePrivacy();
  const hidden = amountsHidden || fullPrivacy;
  const { colors } = useTheme();
  const styles = useStyles();
  const { activeId: workspaceId } = useActiveSpace();
  // Facts first: when the feature is off for this Space the first call answers "unavailable" and
  // nothing else is requested. The forecast is then best-effort.
  const load = useCallback(async () => {
    if (!workspaceId) return null;
    const facts = await fetchIntelligence(workspaceId);
    if (!facts.ok) return { facts: null, failure: `${facts.reason}: ${facts.message}`, wallets: [] as WalletForecast[], computedAt: null };
    const forecast = await fetchForecast({ workspaceId, accountId: null, days: HORIZON });
    // Fire and forget: a new "forecast updated" notification shows up in the Inbox on its next load.
    void notifyInsightChange(workspaceId);
    return { facts, failure: null, wallets: forecast.ok ? forecast.wallets : [], computedAt: forecast.ok ? forecast.computedAt : facts.computedAt };
  }, [workspaceId]);
  const { data: loaded, error } = useQuery(load, workspaceId ?? "none");

  const data = loaded?.facts ?? null;
  const wallets = loaded?.wallets ?? [];
  const wallet: WalletForecast | null = wallets.find((w) => w.id === data?.defaultWalletId) ?? wallets[0] ?? null;

  // Preview builds only: say why the card is missing instead of vanishing silently. Never shown in release builds.
  if (__DEV__ && !data && !wallet && (loaded?.failure || error)) {
    return <Text variant="caption" color="textMuted">{`Insights hidden (dev note): ${loaded?.failure ?? error}`}</Text>;
  }
  const rows = summaryRows(data, wallet, HORIZON, hidden);
  if (rows.length === 0) return null;
  const open = () => router.push("/forecast");
  const outlook = wallet ? outlookFor(wallet, HORIZON, hidden, loaded?.computedAt ?? new Date().toISOString()) : null;

  return (
    <HomeSection
      title="Your money outlook"
      subtitle="Will your money last, and what stands out"
      action={<HomeLink label="See all" onPress={open} />}
    >
      {outlook ? <Pressable accessibilityRole="button" accessibilityHint="Opens your full money outlook" onPress={open}><OutlookCard outlook={outlook} compact /></Pressable> : null}
      <View style={styles.rows}>
        {rows.map((row, i) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            accessibilityLabel={`${row.title}. ${row.detail}`}
            onPress={open}
            style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && styles.pressed]}
          >
            <View style={styles.icon}><Feather name={row.icon} size={18} color={colors.accent} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{row.title}</Text>
              <Text variant="caption" color="textSecondary">{row.detail}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </HomeSection>
  );
}

const useStyles = makeStyles((c) => StyleSheet.create({
  rows: { marginTop: space[1] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[3], minHeight: 56 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: c.borderSubtle },
  pressed: { opacity: 0.6 },
  icon: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" },
}));
