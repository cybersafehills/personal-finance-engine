import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

// The raised, blue, round Pay button in the middle of the bottom bar (the web's
// elevated centre trigger). A tap opens the Pay sheet. A hold, when one is set
// (`onHold`), jumps straight to the chosen action after `holdMs`.
export function PayTabButton({
  onPress,
  onHold,
  holdMs = 500,
  hint = "Opens Pay and Services",
  floating = false,
}: {
  onPress: () => void;
  onHold?: () => void;
  holdMs?: number;
  hint?: string;
  floating?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={floating ? styles.floatingSlot : styles.slot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pay"
        accessibilityHint={hint}
        onPress={onPress}
        onLongPress={onHold}
        delayLongPress={holdMs}
        style={({ pressed }) => [styles.circle, floating && styles.floatingCircle, pressed && { opacity: 0.85 }]}
      >
        <Feather name="send" size={20} color={colors.onSolid} />
      </Pressable>
      {floating ? null : <Text variant="caption" color="textMuted" style={styles.label}>
        Pay
      </Text>}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  floatingSlot:{width:48,height:48},
  floatingCircle:{marginTop:0},
  slot: { flex: 1, alignItems: "center", justifyContent: "flex-start" },
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginTop: -14,
    backgroundColor: colors.accentSolid,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 8px rgba(51, 80, 158, 0.35)",
  },
  label: { marginTop: 2, fontSize: 11, lineHeight: 14 },
}));
