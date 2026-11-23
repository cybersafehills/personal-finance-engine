import { StyleSheet, View } from "react-native";

import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { radii, type ColorToken } from "@/theme/tokens";

export type ProgressTone = "accent" | "positive" | "attention";

const TONE_TOKEN = { accent: "accent", positive: "moneyPositive", attention: "attention" } as const satisfies Record<ProgressTone, ColorToken>;

/**
 * A horizontal meter. `fraction` is clamped to 0-1. Exposed to screen readers
 * as a progress bar with its percentage, so the meaning is never colour-only.
 */
export function ProgressBar({
  fraction,
  tone = "accent",
  label,
}: {
  fraction: number;
  tone?: ProgressTone;
  /** Spoken name, e.g. "Wants budget used". */
  label: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: colors[TONE_TOKEN[tone]] }]} />
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.borderSubtle,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radii.pill },
}));
