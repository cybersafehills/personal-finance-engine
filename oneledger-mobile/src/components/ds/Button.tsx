import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
} from "react-native";

import { colors, MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
};

/** Primary action control. Always at least 44pt tall. */
export function Button({
  label,
  variant = "primary",
  loading = false,
  fullWidth = false,
  disabled,
  ...rest
}: ButtonProps) {
  const inactive = disabled || loading;
  const foreground = variant === "primary" ? "accentForeground" : "accent";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variant === "primary" && {
          backgroundColor: pressed ? colors.accentPressed : colors.accent,
        },
        variant === "secondary" && [
          styles.secondary,
          pressed && { backgroundColor: colors.background },
        ],
        variant === "ghost" && pressed && { backgroundColor: colors.background },
        inactive && styles.inactive,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors[foreground]} />
      ) : (
        <Text variant="bodyStrong" color={foreground}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    borderRadius: radii.control,
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  fullWidth: { alignSelf: "stretch" },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderWidth: 1,
  },
  inactive: { opacity: 0.5 },
});
