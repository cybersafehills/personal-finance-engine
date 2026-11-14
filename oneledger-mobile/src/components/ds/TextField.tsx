import { useId, useState } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { colors, radii, space } from "@/theme/tokens";
import { fonts } from "@/theme/typography";

import { Text } from "./Text";

export type TextFieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  help?: string;
  error?: string;
};

/**
 * Labelled text input: label + optional help + error, wired for assistive
 * tech once. Text is 16pt so iOS never zooms on focus; 48pt tall.
 */
export function TextField({ label, help, error, ...input }: TextFieldProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text variant="label" color="textSecondary" nativeID={`${id}-label`}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={`${id}-label`}
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
        style={[
          styles.input,
          focused && styles.focused,
          !!error && styles.invalid,
        ]}
      />
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
  input: {
    minHeight: 48,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: space[3],
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.textPrimary,
  },
  focused: { borderColor: colors.accent, borderWidth: 2 },
  invalid: { borderColor: colors.attention },
});
