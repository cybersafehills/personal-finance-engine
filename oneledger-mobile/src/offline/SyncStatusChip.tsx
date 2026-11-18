import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { colors, MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

import { useOffline } from "./offline-context";

/**
 * A small, quiet indicator in the header. Hidden when everything is synced (the
 * normal state), so offline use feels ordinary rather than like an error.
 * Opens the sync details screen.
 */
export function SyncStatusChip() {
  const { status } = useOffline();
  if (status.kind === "synced" || status.kind === "unavailable") return null;
  const attention = status.kind === "attention";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${status.label}. ${status.detail} Open sync details`}
      onPress={() => router.push("/sync")}
      style={styles.hit}
    >
      <View style={[styles.chip, attention && styles.chipAttention]}>
        <View style={[styles.dot, attention ? styles.dotAttention : status.kind === "offline" ? styles.dotOffline : styles.dotActive]} />
        <Text variant="caption" color={attention ? "attention" : "textSecondary"} numberOfLines={1}>
          {status.label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { minHeight: MIN_TOUCH_TARGET, justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[2],
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  chipAttention: { backgroundColor: colors.attentionBg, borderColor: colors.attention },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: colors.accent },
  dotOffline: { backgroundColor: colors.textMuted },
  dotAttention: { backgroundColor: colors.attention },
});
