import { Pressable, StyleSheet } from "react-native";

import { colors, MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

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
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { backgroundColor: colors.background },
});
