import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  MoneyAmount,
  Screen,
  Text,
} from "@/components/ds";
import {
  displayName,
  isFailed,
  needsReview,
  signedAmountRwf,
  transactionTypeLabel,
} from "@/features/transactions/display";
import { getTransactionById } from "@/features/transactions/queries";
import { ReceiptCard } from "@/features/receipts/ReceiptCard";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";
import { formatFullDateTime } from "@/lib/kigali-time";
import { formatRwf } from "@/lib/money";
import { space } from "@/theme/tokens";

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => getTransactionById(id), [id]);
  const { data: transaction, loading, error, refresh } = useQuery(load);

  const back = (
    <Button label="Back" variant="ghost" onPress={() => router.back()} />
  );

  if (!transaction) {
    return (
      <Screen>
        {back}
        {loading ? (
          <Text variant="label" color="textMuted">
            Loading…
          </Text>
        ) : (
          <EmptyState
            variant="setup"
            title={error ?? "This transaction isn't available"}
            description={error ? undefined : "It may have been removed or merged."}
            action={
              error ? (
                <Button label="Try again" variant="secondary" onPress={refresh} />
              ) : undefined
            }
          />
        )}
      </Screen>
    );
  }

  const failed = isFailed(transaction);

  return (
    <Screen>
      {back}

      <Card style={{ gap: space[2] }}>
        <Text variant="caption" color="textMuted">
          {transactionTypeLabel(transaction.transaction_type)}
        </Text>
        <Text variant="heading">{displayName(transaction)}</Text>
        {/* The detail view is a deliberate destination: never masked. */}
        <MoneyAmount amountRwf={signedAmountRwf(transaction)} size="xl" masked={false} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {failed ? <Badge variant="attention">Failed: no money moved</Badge> : null}
          {needsReview(transaction) ? <Badge variant="attention">Needs review</Badge> : null}
        </View>
      </Card>

      <Card style={{ gap: space[3] }}>
        <Row label="When" value={formatFullDateTime(transaction.occurred_at)} />
        <Row label="Category" value={transaction.category ?? "Uncategorized"} />
        {transaction.subcategory ? (
          <Row label="Subcategory" value={transaction.subcategory} />
        ) : null}
        {needsReview(transaction) && transaction.suggested_category ? (
          <Row label="Suggested" value={transaction.suggested_category} />
        ) : null}
        <Row label="Fee" value={formatRwf(transaction.fee_rwf)} />
        {transaction.balance_after_rwf !== null ? (
          <Row label="Balance after" value={formatRwf(transaction.balance_after_rwf)} />
        ) : null}
        {transaction.counterparty_reference ? (
          <Row label="Reference" value={transaction.counterparty_reference} />
        ) : null}
      </Card>

      <ReceiptCard transactionId={transaction.id} />

      {failed ? null : (
        <Button
          label={transaction.category ? "Change category" : "Choose a category"}
          fullWidth
          onPress={() =>
            router.push({ pathname: "/category/[id]", params: { id: transaction.id } })
          }
        />
      )}

      {config.apiBaseUrl ? (
        <Button
          label="Edit on the web"
          variant="secondary"
          fullWidth
          onPress={() =>
            Linking.openURL(`${config.apiBaseUrl}/transactions/${transaction.id}`)
          }
        />
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
      <Text variant="label" color="textMuted">
        {label}
      </Text>
      <Text variant="label" tabular style={{ flex: 1, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}
