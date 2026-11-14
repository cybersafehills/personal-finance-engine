import { StyleSheet, View } from "react-native";

import { colors, radii, space } from "@/theme/tokens";

import { Text } from "./Text";

/**
 * "Step N of M" progress chrome for guided flows. Presentational: the
 * caller owns which step is current (usually derived from real state).
 * Progress is stated in text; the bar only reinforces it.
 */
export function StepWizard({
  current,
  total,
  title,
}: {
  /** 1-based. */
  current: number;
  total: number;
  title: string;
}) {
  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current} of ${total}: ${title}`}
      accessibilityValue={{ min: 1, max: total, now: current }}
    >
      <Text variant="caption" color="textMuted">
        Step {current} of {total}
      </Text>
      <Text variant="heading">{title}</Text>
      <View style={styles.track}>
        {Array.from({ length: total }, (_, index) => (
          <View
            key={index}
            style={[styles.segment, index < current && styles.segmentDone]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[1] },
  track: { flexDirection: "row", gap: space[1], marginTop: space[2] },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
  },
  segmentDone: { backgroundColor: colors.accent },
});
