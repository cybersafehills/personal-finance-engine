import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { space } from "@/theme/tokens";
import { fonts } from "@/theme/typography";

import { Card } from "./Card";
import { Text } from "./Text";

/**
 * Empty / setup state. Answers: what this is for, why it matters, and the
 * next step (`action`). `variant="setup"` is the higher-emphasis card for
 * screens where the next step is the whole point.
 */
export function EmptyState({
  title,
  description,
  action,
  variant = "plain",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "plain" | "setup";
}) {
  const inner = (
    <View style={styles.inner}>
      <Text variant="label" color="textSecondary" style={styles.center}>
        {title}
      </Text>
      {description ? (
        <Text variant="label" color="textMuted" style={styles.description}>
          {description}
        </Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );

  if (variant === "setup") {
    return <Card style={styles.setup}>{inner}</Card>;
  }
  return <View style={styles.plain}>{inner}</View>;
}

const styles = StyleSheet.create({
  inner: { alignItems: "center", gap: space[1] },
  center: { textAlign: "center" },
  description: { textAlign: "center", fontFamily: fonts.regular },
  action: { marginTop: space[3] },
  setup: { paddingVertical: space[10] },
  plain: { paddingHorizontal: space[4], paddingVertical: space[12] },
});
