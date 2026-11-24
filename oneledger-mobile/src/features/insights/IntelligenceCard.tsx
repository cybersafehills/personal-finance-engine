import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { HomeLink, HomeSection } from "@/features/home/HomeCards";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { space } from "@/theme/tokens";

import { OutlookCard } from "./OutlookCard";
import { outlookFor, summaryRows, type SectionId } from "./story";
import { OUTLOOK_DAYS, type OutlookData } from "./useOutlookData";

/**
 * Home's money outlook: ONE verdict ("You're on track" / "Your money may run out in about 2 days")
 * and at most four one-line rows, however much activity the account has. Each row opens the full
 * outlook page AT THAT SECTION, so "2 payments much bigger than usual" lands on those payments, not
 * on the top of a generic page. Renders nothing when the feature is off for this Space or there is
 * nothing to say - Home never waits on it or breaks because of it.
 */
export function IntelligenceCard({ outlook, error }: { outlook: OutlookData | null; error: string | null }) {
  const { amountsHidden, fullPrivacy } = usePrivacy();
  const hidden = amountsHidden || fullPrivacy;
  const { colors } = useTheme();
  const styles = useStyles();
  const data = outlook?.facts ?? null;
  const wallet = outlook?.wallet ?? null;

  // Preview builds only: say why the card is missing instead of vanishing silently. Never shown in release builds.
  if (__DEV__ && !data && !wallet && (outlook?.failure || error)) {
    return <Text variant="caption" color="textMuted">{`Insights hidden (dev note): ${outlook?.failure ?? error}`}</Text>;
  }
  const rows = summaryRows(data, wallet, OUTLOOK_DAYS, hidden);
  if (rows.length === 0) return null;
  const open = (section?: SectionId) => router.push(section ? { pathname: "/forecast", params: { section } } : "/forecast");
  const verdict = wallet ? outlookFor(wallet, OUTLOOK_DAYS, hidden, outlook?.computedAt ?? new Date().toISOString()) : null;

  return (
    <HomeSection
      title="Your money outlook"
      subtitle="Will your money last, and what stands out"
      action={<HomeLink label="See all" onPress={() => open()} />}
    >
      {verdict ? <Pressable accessibilityRole="button" accessibilityHint="Opens your full money outlook" onPress={() => open("outlook")}><OutlookCard outlook={verdict} compact /></Pressable> : null}
      <View style={styles.rows}>
        {rows.map((row, i) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            accessibilityLabel={`${row.title}. ${row.detail}`}
            accessibilityHint="Opens this part of your money outlook"
            onPress={() => open(row.key)}
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
