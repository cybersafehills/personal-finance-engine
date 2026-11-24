import Feather from "@expo/vector-icons/Feather";
import type { ReactNode, RefObject } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";

import { Text } from "@/components/ds";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import type { Palette } from "@/theme/colors";
import { space } from "@/theme/tokens";

import { TONE_STATUS, type SectionTone } from "./story";

// One colour language for the whole outlook page, so a glance tells you what to read first:
//   red    = needs attention now      amber = worth a look
//   blue   = good to know             green = all good
// Colour is never the only signal: every card also carries an icon and the words in `TONE_STATUS`.

type FeatherName = React.ComponentProps<typeof Feather>["name"];

export function toneColors(c: Palette, tone: SectionTone): { ink: string; wash: string; icon: FeatherName } {
  switch (tone) {
    case "urgent": return { ink: c.danger, wash: c.needsMapBg, icon: "alert-triangle" };
    case "check": return { ink: c.attention, wash: c.attentionBg, icon: "eye" };
    case "info": return { ink: c.accent, wash: c.accentBg, icon: "info" };
    case "good": return { ink: c.moneyPositive, wash: c.moneyPositiveBg, icon: "check-circle" };
  }
}

/** A section of the outlook page: a coloured header band (what it is + how important), then its content. */
export function SectionShell({ tone, icon, title, subtitle, anchor, children }: {
  tone: SectionTone;
  icon: FeatherName;
  title: string;
  subtitle: string;
  /** Lets Home's rows scroll straight to this section. */
  anchor?: RefObject<ViewInstance | null>;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = toneColors(colors, tone);
  return (
    <View ref={anchor} collapsable={false} style={[styles.card, { borderLeftColor: t.ink }]} accessibilityLabel={`${title}. ${TONE_STATUS[tone]}`}>
      <View style={[styles.band, { backgroundColor: t.wash }]}>
        <View style={[styles.badge, { borderColor: t.ink }]}><Feather name={icon} size={18} color={t.ink} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.pill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Feather name={t.icon} size={12} color={t.ink} />
            <Text variant="caption" style={{ color: t.ink, fontWeight: "700" }}>{TONE_STATUS[tone]}</Text>
          </View>
          <Text variant="heading" accessibilityRole="header">{title}</Text>
          <Text variant="caption" color="textSecondary">{subtitle}</Text>
        </View>
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const useStyles = makeStyles((c) => StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: 16, borderCurve: "continuous", overflow: "hidden", borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.borderSubtle, borderLeftWidth: 5 },
  band: { flexDirection: "row", gap: space[3], padding: space[4], alignItems: "flex-start" },
  badge: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: "center", justifyContent: "center", backgroundColor: c.surface },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  body: { padding: space[4], gap: space[3] },
}));
