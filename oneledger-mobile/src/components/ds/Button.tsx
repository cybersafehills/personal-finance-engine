import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { privateText } from "@/features/privacy/mask";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
} from "react-native";

import { colors, CONTROL_HEIGHT, hitSlopFor, radii, space } from "@/theme/tokens";

import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  /** `sm` is for inline actions (Back, row actions); `md` is the default. */
  size?: "md" | "sm";
};

/** Primary action control. Looks 40pt (32pt `sm`); the touch area is always 44pt or more. */
export function Button({
  label,
  variant = "primary",
  loading = false,
  fullWidth = false,
  size = "md",
  disabled,
  ...rest
}: ButtonProps) {
  const { fullPrivacy } = usePrivacy();
  const inactive = disabled || loading;
  const foreground = variant === "primary" ? "accentForeground" : "accent";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      hitSlop={hitSlopFor(CONTROL_HEIGHT[size])}
      {...rest}
      accessibilityLabel={privateText(rest.accessibilityLabel, fullPrivacy)}
      style={({ pressed }) => [
        styles.base,
        size === "sm" && styles.small,
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
        <ActivityIndicator size="small" color={colors[foreground]} />
      ) : (
        <Text variant={size === "sm" ? "label" : "bodyStrong"} color={foreground}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: CONTROL_HEIGHT.md,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    borderRadius: radii.control,
    borderCurve: "continuous",
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  small: {
    minHeight: CONTROL_HEIGHT.sm,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  fullWidth: { alignSelf: "stretch" },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderWidth: 1,
  },
  inactive: { opacity: 0.5 },
});
