import Feather from "@expo/vector-icons/Feather";
import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { space } from "@/theme/tokens";

import { phaseCopy, type PayPhase } from "./status";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

const SIZE = 72;

/**
 * The payment's live mark: a ring that spins while we wait, which turns into a
 * blue tick when the money went through, or a red cross when it did not.
 * Announced to screen readers as a polite status.
 */
export function PaymentStatus({
  phase,
  intent,
  amountLabel,
  recipient,
}: {
  phase: PayPhase;
  intent: { state: string; verified: boolean };
  amountLabel: string;
  recipient: string | null;
}) {
  const styles = useStyles();
  const copy = phaseCopy(phase, intent, amountLabel, recipient);
  return (
    <View accessibilityRole="summary" accessibilityLiveRegion="polite" style={styles.wrap}>
      <Mark key={phase} phase={phase} />
      <Text variant="heading" accessibilityRole="header">
        {copy.title}
      </Text>
      <Text variant="label" color="textSecondary" style={styles.body}>
        {copy.body}
      </Text>
    </View>
  );
}

function Mark({ phase }: { phase: PayPhase }) {
  const styles = useStyles();
  const { colors } = useTheme();
  // Created once per mark (the mark is re-keyed per phase), never read from a ref in render.
  const [spin] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(phase === "waiting" ? 1 : 0.5));

  useEffect(() => {
    if (phase === "waiting") {
      const loop = Animated.loop(
        Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }),
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  }, [phase, spin, pop]);

  if (phase === "waiting") {
    const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
    return <Animated.View testID="status-spinner" style={[styles.ring, { transform: [{ rotate }] }]} />;
  }
  const success = phase === "success";
  return (
    <Animated.View
      testID={success ? "status-tick" : "status-cross"}
      style={[styles.disc, { backgroundColor: success ? colors.accent : colors.notificationBadge, transform: [{ scale: pop }] }]}
    >
      <Feather name={success ? "check" : "x"} size={40} color={colors.onSolid} />
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  wrap: { alignItems: "center", gap: space[2], paddingVertical: space[4] },
  body: { textAlign: "center" },
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 5,
    borderColor: colors.borderSubtle,
    borderTopColor: colors.accent,
  },
  disc: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: "center", justifyContent: "center" },
}));
