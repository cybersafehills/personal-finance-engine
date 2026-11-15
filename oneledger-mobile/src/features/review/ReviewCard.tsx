import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { Button, Text } from "@/components/ds";
import { reviewPrompt } from "@/features/transactions/display";
import type { TransactionRow } from "@/features/transactions/queries";
import { TransactionItem } from "@/features/transactions/TransactionItem";
import { colors, space } from "@/theme/tokens";

/** A review-queue transaction with its one-tap decisions underneath. */
export function ReviewCard({
  transaction,
  busy,
  error,
  onConfirm,
  onDismiss,
}: {
  transaction: TransactionRow;
  busy: boolean;
  error: string | null;
  onConfirm(): void;
  onDismiss(): void;
}) {
  const prompt = reviewPrompt(transaction);
  return (
    <View style={styles.card}>
      <TransactionItem transaction={transaction} showDate masked={false} />
      <View style={styles.body}>
        <Text variant="label" color="textSecondary">
          {prompt.message}
        </Text>
        {error ? (
          <Text variant="caption" color="attention" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {prompt.confirmLabel ? (
            <Button label={prompt.confirmLabel} loading={busy} disabled={busy} onPress={onConfirm} />
          ) : null}
          <Button label={prompt.dismissLabel} variant="secondary" disabled={busy} onPress={onDismiss} />
          <Button
            label="Pick another"
            variant="ghost"
            disabled={busy}
            onPress={() =>
              router.push({ pathname: "/category/[id]", params: { id: transaction.id } })
            }
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, paddingBottom: space[3] },
  body: { paddingHorizontal: space[3], gap: space[2] },
  actions: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
});
