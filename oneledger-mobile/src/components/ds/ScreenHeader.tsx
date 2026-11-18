import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { space } from "@/theme/tokens";
import { fonts } from "@/theme/typography";

import { Text } from "./Text";

/**
 * A screen's title. On a pushed screen the title goes to the native navigation
 * header (back arrow, platform behaviour), and the body keeps only the optional
 * subtitle and trailing action. Screens that live under the app header (the tabs,
 * and a view embedded in one) pass `inline` to draw the title in the body instead.
 */
export function ScreenHeader({
  title,
  subtitle,
  action,
  inline = false,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  inline?: boolean;
}) {
  const hasBody = inline || !!subtitle || !!action;
  return (
    <>
      {inline ? null : <Stack.Screen options={{ title }} />}
      {hasBody ? (
        <View style={styles.row}>
          <View style={styles.titles}>
            {inline ? (
              <Text variant="title" accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text variant="label" color="textMuted" style={inline ? styles.subtitle : undefined}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[3],
  },
  titles: { flex: 1 },
  subtitle: { marginTop: 2, fontFamily: fonts.regular },
});
