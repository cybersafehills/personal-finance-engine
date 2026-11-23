import { Pressable, StyleSheet } from "react-native";

import { CONTROL_HEIGHT, hitSlopFor, radii, space } from "@/theme/tokens";
import { fonts } from "@/theme/typography";

import { Text } from "./Text";
import { makeStyles } from "@/theme/ThemeProvider";

const CHIP_COMPACT_HEIGHT = 28;

/**
 * A selectable pill for filters (period, wallet). Selection is announced to
 * assistive tech and shown with a filled background AND bold text - never
 * colour alone.
 */
export function Chip({
  label,
  selected,
  onPress,
  compact = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** 28pt with 12px text, for dense filter rows (the hit area stays 44pt). */
  compact?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={selected ? `${label}, selected` : label}
      hitSlop={hitSlopFor(compact ? CHIP_COMPACT_HEIGHT : CONTROL_HEIGHT.sm)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        compact && styles.compact,
        selected && styles.selected,
        pressed && !selected && styles.pressed,
      ]}
    >
      <Text
        variant={compact ? "caption" : selected ? "bodyStrong" : "label"}
        color={selected ? "onSolid" : "textSecondary"}
        style={compact && selected ? { fontFamily: fonts.semibold } : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  chip: {
    minHeight: CONTROL_HEIGHT.sm,
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  compact: { minHeight: CHIP_COMPACT_HEIGHT, paddingHorizontal: space[2] },
  selected: { backgroundColor: colors.accentSolid, borderColor: colors.accentSolid },
  pressed: { backgroundColor: colors.background },
}));
