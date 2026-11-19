import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Badge, MoneyAmount, Text } from "@/components/ds";
import { formatDateTime, formatTime } from "@/lib/kigali-time";
import { colors, radii, space } from "@/theme/tokens";

import { displayName, isFailed, needsReview, signedAmountRwf } from "./display";
import type { TransactionRow } from "./queries";

/** One transaction row; opens the detail screen. */
export function TransactionItem({
  transaction,
  showDate = false,
  masked,
}: {
  transaction: TransactionRow;
  /** Date + time for ungrouped lists (Home); time only under a day header. */
  showDate?: boolean;
  /** Pass `false` to always show the amount (the Transactions screen is a
   *  deliberate destination and is never masked); omit to follow privacy mode. */
  masked?: boolean;
}) {
  const name = displayName(transaction);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, open details`}
      onPress={() =>
        router.push({ pathname: "/transaction/[id]", params: { id: transaction.id } })
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.meta}>
          <Text variant="caption" color="textMuted">
            {showDate
              ? formatDateTime(transaction.occurred_at)
              : formatTime(transaction.occurred_at)}
            {transaction.category ? ` · ${transaction.category}` : ""}
          </Text>
          {!transaction.category ? <Badge variant="attention">Uncategorized</Badge> : null}
          {isFailed(transaction) ? <Badge variant="attention">Failed</Badge> : null}
          {needsReview(transaction) ? <Badge variant="attention">Review</Badge> : null}
          {transaction.sync_state === "failed" ? (
            <Badge variant="attention">Not sent</Badge>
          ) : transaction.sync_state && transaction.sync_state !== "synced" ? (
            <Badge variant="neutral">Saved on this phone</Badge>
          ) : null}
        </View>
      </View>
      <MoneyAmount amountRwf={signedAmountRwf(transaction)} masked={masked} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radii.control,
  },
  pressed: { backgroundColor: colors.background },
  text: { flex: 1, gap: 2 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1] },
});
