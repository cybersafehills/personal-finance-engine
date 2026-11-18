import { Pressable, StyleSheet } from "react-native";

import { colors, CONTROL_HEIGHT, hitSlopFor, radii, space } from "@/theme/tokens";

import { Text } from "./Text";

/**
 * A selectable pill for filters (period, wallet). Selection is announced to
 * assistive tech and shown with a filled background AND bold text - never
 * colour alone.
 */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={selected ? `${label}, selected` : label}
      hitSlop={hitSlopFor(CONTROL_HEIGHT.sm)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        pressed && !selected && styles.pressed,
      ]}
    >
      <Text variant={selected ? "bodyStrong" : "label"} color={selected ? "accentForeground" : "textSecondary"}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: CONTROL_HEIGHT.sm,
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { backgroundColor: colors.background },
});
