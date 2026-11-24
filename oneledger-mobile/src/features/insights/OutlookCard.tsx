import Feather from "@expo/vector-icons/Feather";
import { StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { space } from "@/theme/tokens";

import type { Outlook } from "./story";

const ICON = { good: "check-circle", watch: "info", alert: "alert-triangle" } as const;

/** The one-sentence answer to "will my money last?": an icon, a clear title, and one plain sentence. */
export function OutlookCard({ outlook, compact = false }: { outlook: Outlook; compact?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const ink = outlook.tone === "good" ? colors.moneyPositive : colors.attention;
  const wash = outlook.tone === "good" ? colors.moneyPositiveBg : colors.attentionBg;
  return (
    <View style={[styles.card, { backgroundColor: wash }]} accessible accessibilityRole="summary" accessibilityLabel={`${outlook.title}. ${outlook.message}`}>
      <View style={[styles.badge, { borderColor: ink }]}><Feather name={ICON[outlook.tone]} size={compact ? 18 : 22} color={ink} /></View>
      <View style={{ flex: 1, gap: space[1] }}>
        <Text variant={compact ? "bodyStrong" : "heading"} style={{ color: ink }}>{outlook.title}</Text>
        <Text variant={compact ? "label" : "body"} color="textPrimary">{outlook.message}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  card: { flexDirection: "row", gap: space[3], padding: space[4], borderRadius: 16, alignItems: "flex-start" },
  badge: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
}));
