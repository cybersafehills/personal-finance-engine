import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { dateGroupLabel, formatTime } from "@/lib/kigali-time";
import { formatRwf } from "@/lib/money";
import { colors, MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

/**
 * Home's headline balance, as on the web (web/components/BalanceCard.tsx): a
 * solid accent card with the show/hide eye on the card itself. Freshness is
 * never masked and never implied to be live: the balance is only as current
 * as the last MoMo message.
 */
export function BalanceCard({
  balance,
  nowIso,
}: {
  balance: { amountRwf: number; asOfIso: string } | null;
  nowIso: string;
}) {
  const { amountsHidden, toggleAmountsHidden } = usePrivacy();
  const label = amountsHidden ? "Show current balance" : "Hide current balance";

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text variant="label" color="accentForeground" style={styles.dim}>
          Current balance
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={toggleAmountsHidden}
          style={({ pressed }) => [styles.eye, pressed && styles.eyePressed]}
        >
          <Feather
            name={amountsHidden ? "eye-off" : "eye"}
            size={20}
            color={colors.accentForeground}
          />
        </Pressable>
      </View>

      <Text variant="display" color="accentForeground" tabular style={styles.amount}>
        {amountsHidden ? "••••••" : balance ? formatRwf(balance.amountRwf) : "—"}
      </Text>

      <View style={styles.footer}>
        <Text variant="label" color="accentForeground" style={styles.dim}>
          MTN Mobile Money
        </Text>
        {balance ? (
          <Text variant="caption" color="accentForeground" style={styles.faint}>
            {`Updated ${dateGroupLabel(balance.asOfIso, nowIso)}, ${formatTime(balance.asOfIso)}`}
          </Text>
        ) : null}
      </View>
      {!balance ? (
        <Text variant="caption" color="accentForeground" style={styles.faint}>
          No balance yet. It appears after your first recorded MoMo message.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: space[6],
    paddingVertical: space[6],
    gap: space[1],
  },
  top: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  dim: { opacity: 0.8 },
  faint: { opacity: 0.65 },
  amount: { marginTop: space[2] },
  eye: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    marginTop: -space[2],
    marginRight: -space[2],
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  eyePressed: { backgroundColor: colors.accentPressed },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space[3],
  },
});
