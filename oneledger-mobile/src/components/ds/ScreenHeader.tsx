import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { space } from "@/theme/tokens";
import { fonts } from "@/theme/typography";

import { Text } from "./Text";

/** Screen title + optional subtitle and trailing action. */
export function ScreenHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="label" color="textMuted" style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[3],
    marginBottom: space[2],
  },
  titles: { flex: 1 },
  subtitle: { marginTop: 2, fontFamily: fonts.regular },
});
