import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Badge, Text } from "@/components/ds";
import { formatDateTime, formatTime } from "@/lib/kigali-time";
import { radii, space } from "@/theme/tokens";

import { displayName, isFailed, isPending, needsReview } from "./display";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { formatMoney, type SupportedCurrency } from "@/lib/money";
import type { TransactionRow } from "./queries";
import { makeStyles } from "@/theme/ThemeProvider";

/** One transaction row; opens the detail screen. */
export function TransactionItem({
  transaction,
  showDate = false,
  masked,
  compact = false,
}: {
  transaction: TransactionRow;
  /** Date + time for ungrouped lists (Home); time only under a day header. */
  showDate?: boolean;
  /** Pass `false` to always show the amount (the Transactions screen is a
   *  deliberate destination and is never masked); omit to follow privacy mode. */
  masked?: boolean;
  compact?: boolean;
}) {
  const styles = useStyles();
  const name = displayName(transaction);
  const { amountsHidden } = usePrivacy();
  const hidden = masked ?? amountsHidden;
  const pending = isPending(transaction), failed = isFailed(transaction);
  const currency = transaction.currency.trim();
  const supported = ["RWF", "USD", "EUR"].includes(currency);
  const amount = Number(transaction.amount_rwf);
  const formatted = !Number.isSafeInteger(amount) ? "Amount unavailable" : supported ? formatMoney(BigInt(Math.abs(amount)), currency as SupportedCurrency) : `${currency} ${Math.abs(amount).toLocaleString("en-US")}`;
  const sign = pending || failed || transaction.direction === "neutral" ? "" : transaction.direction === "in" ? "+" : "−";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, open details`}
      onPress={() =>
        router.push({ pathname: "/transaction/[id]", params: { id: transaction.id } })
      }
      style={({ pressed }) => [styles.row, compact && styles.compact, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1} style={compact ? styles.compactName : undefined}>
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
          {failed ? <Badge variant="attention">{transaction.settlement_state === "reversed" || transaction.status === "reversed" ? "Reversed" : transaction.status === "cancelled" ? "Cancelled" : "Failed"}</Badge> : null}
          {pending ? <Badge variant="neutral">{transaction.status === "unknown" || transaction.settlement_state === "unknown" ? "Unconfirmed" : "Pending"}</Badge> : null}
          {!hidden && transaction.fee_rwf > 0 ? <Text variant="caption" color="textMuted">{`Fee ${supported ? formatMoney(BigInt(transaction.fee_rwf), currency as SupportedCurrency) : `${currency} ${transaction.fee_rwf}`}`}</Text> : null}
          {needsReview(transaction) ? <Badge variant="attention">Review</Badge> : null}
          {transaction.sync_state === "failed" ? (
            <Badge variant="attention">Not sent</Badge>
          ) : transaction.sync_state && transaction.sync_state !== "synced" ? (
            <Badge variant="neutral">Saved on this phone</Badge>
          ) : null}
        </View>
      </View>
      <Text variant="bodyStrong" tabular color={!pending && !failed && transaction.direction === "in" ? "moneyPositive" : "textPrimary"} accessibilityLabel={hidden ? "Amount hidden" : undefined} style={styles.amount}>{hidden ? "••••••" : `${sign}${formatted}`}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
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
  compact: { paddingHorizontal: 0, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  compactName: { fontSize: 14, lineHeight: 20 },
  amount: { flexShrink: 1, maxWidth: "48%", textAlign: "right" },
}));
