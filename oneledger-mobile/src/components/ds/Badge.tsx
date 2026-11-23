import { StyleSheet, View } from "react-native";

import { radii, space, type ColorToken } from "@/theme/tokens";

import { Text } from "./Text";
import { useTheme } from "@/theme/ThemeProvider";

export type BadgeVariant = "neutral" | "accent" | "attention" | "positive";

const VARIANTS: Record<BadgeVariant, { bg: ColorToken; fg: ColorToken }> = {
  neutral: { bg: "background", fg: "textSecondary" },
  accent: { bg: "accentSolid", fg: "onSolid" },
  attention: { bg: "attentionBg", fg: "attention" },
  positive: { bg: "moneyPositiveBg", fg: "moneyPositive" },
};

/** Small status pill. The label is always text, never colour alone. */
export function Badge({
  children,
  variant = "neutral",
}: {
  children: string;
  variant?: BadgeVariant;
}) {
  const { colors } = useTheme();
  const v = VARIANTS[variant];
  return (
    <View style={[styles.badge, { backgroundColor: colors[v.bg] }]}>
      <Text variant="caption" color={v.fg}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    paddingHorizontal: space[2],
    paddingVertical: 2,
  },
});
