import { StyleSheet, View } from "react-native";

import { colors, radii } from "@/theme/tokens";

export type ProgressTone = "accent" | "positive" | "attention";

const TONES: Record<ProgressTone, string> = {
  accent: colors.accent,
  positive: colors.moneyPositive,
  attention: colors.attention,
};

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
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: TONES[tone] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.borderSubtle,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radii.pill },
});
