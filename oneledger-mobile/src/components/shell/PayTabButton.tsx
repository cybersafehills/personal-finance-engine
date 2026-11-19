import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { colors } from "@/theme/tokens";

// The raised, blue, round Pay button in the middle of the bottom bar (the web's
// elevated centre trigger). A tap opens the Pay sheet. A hold, when one is set
// (`onHold`), jumps straight to the chosen action after `holdMs`.
export function PayTabButton({
  onPress,
  onHold,
  holdMs = 500,
  hint = "Opens Pay and Services",
}: {
  onPress: () => void;
  onHold?: () => void;
  holdMs?: number;
  hint?: string;
}) {
  return (
    <View style={styles.slot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pay"
        accessibilityHint={hint}
        onPress={onPress}
        onLongPress={onHold}
        delayLongPress={holdMs}
        style={({ pressed }) => [styles.circle, pressed && { opacity: 0.85 }]}
      >
        <Feather name="send" size={20} color={colors.accentForeground} />
      </Pressable>
      <Text variant="caption" color="textMuted" style={styles.label}>
        Pay
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1, alignItems: "center", justifyContent: "flex-start" },
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginTop: -14,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 8px rgba(51, 80, 158, 0.35)",
  },
  label: { marginTop: 2, fontSize: 11, lineHeight: 14 },
});
