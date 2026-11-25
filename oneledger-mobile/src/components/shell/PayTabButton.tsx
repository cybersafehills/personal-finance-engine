import { useId } from "react";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import Feather from "@expo/vector-icons/Feather";
import { StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { PressableScale } from "@/components/ds/PressableScale";
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
  const gradientId = `pay-${useId().replace(/:/g, "")}`;
  const { colors } = useTheme();
  return (
    <View style={floating ? styles.floatingSlot : styles.slot}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Pay"
        accessibilityHint={hint}
        onPress={onPress}
        onLongPress={onHold}
        delayLongPress={holdMs}
        style={(pressed) => [styles.circle, floating && styles.floatingCircle, pressed && { opacity: 0.88 }]}
      >
        <Svg width={48} height={48} style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}>
          <Defs><LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.payStart} />
            <Stop offset="1" stopColor={colors.payEnd} />
          </LinearGradient></Defs>
          <Circle cx={24} cy={24} r={24} fill={`url(#${gradientId})`} />
        </Svg>
        <Feather name="send" size={20} color={colors.onSolid} />
      </PressableScale>
      {floating ? null : <Text variant="caption" color="textPrimary" style={styles.label}>
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
    backgroundColor: colors.payStart,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 3px 8px rgba(0, 0, 0, 0.16)",
  },
  label: { marginTop: 2, fontSize: 11, lineHeight: 14 },
}));
