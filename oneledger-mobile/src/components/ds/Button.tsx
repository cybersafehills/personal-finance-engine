import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { privateText } from "@/features/privacy/mask";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
} from "react-native";

import { CONTROL_HEIGHT, hitSlopFor, radii, space } from "@/theme/tokens";

import { Text } from "./Text";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** `positive` (green) is for the one action that moves money forward, such as paying someone. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "positive";

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
  const styles = useStyles();
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const foreground = variant === "primary" || variant === "positive" ? "onSolid" : "accent";

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
          backgroundColor: pressed ? colors.accentSolidPressed : colors.accentSolid,
        },
        variant === "positive" && {
          backgroundColor: pressed ? colors.moneyPositiveSolidPressed : colors.moneyPositiveSolid,
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

const useStyles = makeStyles((colors) => StyleSheet.create({
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
}));
