import { useId, useState, type ReactNode } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { colors, radii, space } from "@/theme/tokens";
import { fonts, MAX_FONT_SCALE } from "@/theme/typography";

import { Text } from "./Text";

export type TextFieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  help?: string;
  error?: string;
  /** An icon or small control drawn inside the box, on the left (e.g. "save as contact"). */
  leading?: ReactNode;
  /** A 40pt box with no visible label (the label is still its accessible name): search bars. */
  compact?: boolean;
};

/**
 * Labelled text input: label + optional help + error, wired for assistive
 * tech once. 44pt tall; text is 15pt, one step above body so what you type stays readable.
 */
export function TextField({ label, help, error, leading, compact = false, ...input }: TextFieldProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      {compact ? null : (
        <Text variant="label" color="textSecondary" nativeID={`${id}-label`}>
          {label}
        </Text>
      )}
      <View
        style={[
          styles.box,
          compact && styles.boxCompact,
          focused && styles.focused,
          !!error && styles.invalid,
        ]}
      >
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        <TextInput
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityLabel={label}
          accessibilityLabelledBy={compact ? undefined : `${id}-label`}
          accessibilityHint={error ?? help}
          aria-invalid={!!error}
          placeholderTextColor={colors.textMuted}
          {...input}
          onFocus={(event) => {
            setFocused(true);
            input.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            input.onBlur?.(event);
          }}
          style={styles.input}
        />
      </View>
      {error ? (
        <Text variant="caption" color="attention" accessibilityRole="alert">
          {error}
        </Text>
      ) : help ? (
        <Text variant="caption" color="textMuted">
          {help}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1] },
  box: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.control,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  boxCompact: { minHeight: 40 },
  leading: { paddingLeft: space[3] },
  input: {
    flex: 1,
    alignSelf: "stretch",
    paddingHorizontal: space[3],
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textPrimary,
  },
  focused: { borderColor: colors.accent, borderWidth: 2 },
  invalid: { borderColor: colors.attention },
});
