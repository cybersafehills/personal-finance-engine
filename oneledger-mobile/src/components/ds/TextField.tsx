import { useId, useState, type ReactNode } from "react";
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { radii, space } from "@/theme/tokens";
import { fonts, MAX_FONT_SCALE } from "@/theme/typography";

import { Text } from "./Text";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

export type TextFieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  help?: string;
  error?: string;
  /** An icon or small control drawn inside the box, on the left (e.g. "save as contact"). */
  leading?: ReactNode;
  /** A control drawn inside the box, on the right (e.g. "choose from my contacts"). */
  trailing?: ReactNode;
  /** A 40pt box with no visible label (the label is still its accessible name): search bars. */
  compact?: boolean;
};

/**
 * Labelled text input: label + optional help + error, wired for assistive
 * tech once. 44pt tall; text is 15pt, one step above body so what you type stays readable.
 */
export function TextField({ label, help, error, leading, trailing, compact = false, ...input }: TextFieldProps) {
  const styles = useStyles();
  const { colors, isDark } = useTheme();
  const id = useId();
  const [focused, setFocused] = useState(false);
  // iPhone number pads have no Return key, so they get a "Done" bar above the keys.
  const numeric = input.keyboardType === "number-pad" || input.keyboardType === "phone-pad" || input.keyboardType === "decimal-pad" || input.keyboardType === "numeric";
  const doneBar = Platform.OS === "ios" && numeric && !input.multiline;

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
          keyboardAppearance={isDark ? "dark" : "light"}
          returnKeyType="done"
          inputAccessoryViewID={doneBar ? `${id}-done` : undefined}
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
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {doneBar ? (
        <InputAccessoryView nativeID={`${id}-done`}>
          <View style={styles.doneBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={Keyboard.dismiss} hitSlop={8} style={styles.doneButton}>
              <Text variant="bodyStrong" color="accent">
                Done
              </Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
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

const useStyles = makeStyles((colors) => StyleSheet.create({
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
  trailing: { paddingRight: space[2] },
  doneBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: space[4],
  },
  doneButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: space[2] },
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
}));
