import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { dateGroupLabel, formatTime } from "@/lib/kigali-time";
import { formatRwf } from "@/lib/money";
import { MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

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
  balance: { amountRwf: number; asOfIso: string; pendingEffectRwf?: number; pendingCount?: number } | null;
  nowIso: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { amountsHidden, toggleAmountsHidden } = usePrivacy();
  const label = amountsHidden ? "Show current balance" : "Hide current balance";

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text variant="label" color="onSolid" style={styles.dim}>
          Recorded balance
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
            color={colors.onSolid}
          />
        </Pressable>
      </View>

      <Text variant="display" color="onSolid" tabular style={styles.amount}>
        {amountsHidden ? "••••••" : balance ? formatRwf(balance.amountRwf) : "—"}
      </Text>

      <View style={styles.footer}>
        <Text variant="label" color="onSolid" style={styles.dim}>
          RWF · Last captured message
        </Text>
        {balance ? (
          <Text variant="caption" color="onSolid" style={styles.faint}>
            {`Updated ${dateGroupLabel(balance.asOfIso, nowIso)}, ${formatTime(balance.asOfIso)}`}
          </Text>
        ) : null}
      </View>
      {balance && balance.pendingCount ? (
        <Text variant="caption" color="onSolid" style={styles.faint}>
          {amountsHidden
            ? `Includes ${balance.pendingCount} unsynced change${balance.pendingCount === 1 ? "" : "s"}`
            : `Provider balance. ${balance.pendingCount} change${balance.pendingCount === 1 ? "" : "s"} saved on this phone not yet confirmed (${formatRwf(balance.pendingEffectRwf ?? 0)}); estimate ${formatRwf(balance.amountRwf + (balance.pendingEffectRwf ?? 0))}.`}
        </Text>
      ) : null}
      {!balance ? (
        <Text variant="caption" color="onSolid" style={styles.faint}>
          No balance yet. It appears after your first recorded MoMo message.
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.accentSolid,
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
  eyePressed: { backgroundColor: colors.accentSolidPressed },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space[3],
  },
}));
