import { GuideAnchor } from "@/features/guides/GuideAnchor";
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
  formatRowAmount,
  settlementLabel,
  signedAmountRwf,
  transactionTypeLabel,
} from "@/features/transactions/display";
import { loadDetailExtras } from "@/features/transactions/detail";
import { AttributionPanel } from "@/features/transactions/AttributionPanel";
import { DuplicatesCard } from "@/features/transactions/DuplicatesCard";
import { TransactionTags } from "@/features/transactions/TransactionTags";
import {
  attentionMessage,
  categoryReason,
  directionLabel,
  historyLine,
  whereFromRows,
} from "@/features/transactions/detailDisplay";
import { explainError } from "@/offline/status";
import { loadPayAgainOffer } from "@/features/pay/context";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { isInRequestedSpace, requestedWorkspaceId } from "@/features/spaces/spaces";
import { getTransactionById } from "@/features/transactions/queries";
import { ReceiptCard } from "@/features/receipts/ReceiptCard";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";
import { formatFullDateTime } from "@/lib/kigali-time";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/ThemeProvider";

export default function TransactionDetail() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useActiveSpace();
  const load = useCallback(() => getTransactionById(id), [id]);
  const { data: transaction, loading, error, refresh } = useQuery(load);

  // "Pay X again": only when it can honestly work (see features/pay/context.ts).
  // Any doubt - config off, shared Space, odd reference - and the button is absent.
  const loadOffer = useCallback(
    () => (transaction ? loadPayAgainOffer(transaction) : Promise.resolve(null)),
    [transaction],
  );
  const { data: payOffer } = useQuery(loadOffer);

  // Where it came from, category history and tags. Each part may be missing on
  // its own; the screen shows whatever loaded.
  const loadExtras = useCallback(() => loadDetailExtras(id), [id]);
  const { data: extras, refresh: refreshExtras } = useQuery(loadExtras);


  if (!transaction) {
    return (
      <Screen>
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
  const unsettled = settlementLabel(transaction);
  // 0 means there is no direction to show; the amount itself is never replaced by 0.
  const signed = signedAmountRwf(transaction);
  const money = (value: number) => formatRowAmount(value, transaction.currency);
  const context = extras?.context ?? null;
  const where = context ? whereFromRows(context, extras?.members ?? [], extras?.selfUserId ?? null) : [];
  const attention = attentionMessage(context?.allocationStatus);
  const latestReason = extras?.history[0]?.decision_reason ?? null;
  const history = extras?.history ?? [];

  // The Inbox covers the ACTIVE Space (the one the server is using), so a flagged
  // transaction anywhere else (or whose Space we couldn't read) is resolved in
  // the web's review queue instead.
  const duplicateReviewAction =
    context && isInRequestedSpace(context, requestedWorkspaceId(active))
      ? { label: "Review it", onPress: () => router.push("/inbox") }
      : config.apiBaseUrl
        ? {
            label: "Review on the web",
            onPress: () => Linking.openURL(`${config.apiBaseUrl}/transactions/review`),
          }
        : null;

  return (
    <Screen>

      {/* Centred hero, like the web: who, how much, when. */}
      <Card style={{ gap: space[2], alignItems: "center" }}>
        <Text variant="caption" color="textMuted" style={{ textAlign: "center" }}>
          {transactionTypeLabel(transaction.transaction_type)}
        </Text>
        <Text variant="heading" style={{ textAlign: "center" }}>
          {displayName(transaction)}
        </Text>
        {/* The detail view is a deliberate destination: never masked. */}
        <MoneyAmount
          amountRwf={signed === 0 ? transaction.amount_rwf : signed}
          currency={transaction.currency.trim()}
          unsigned={signed === 0}
          size="xl"
          masked={false}
        />
        <Text variant="label" color="textMuted" style={{ textAlign: "center" }}>
          {formatFullDateTime(transaction.occurred_at)}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space[2] }}>
          {unsettled ? <Badge variant={failed ? "attention" : "neutral"}>{unsettled}</Badge> : null}
          {needsReview(transaction) ? <Badge variant="attention">Needs review</Badge> : null}
        </View>
      </Card>

      {transaction.sync_state && transaction.sync_state !== "synced" ? (
        <Card style={{ gap: space[1] }} accessibilityRole="summary">
          <Text variant="bodyStrong">
            {transaction.sync_state === "failed" ? "Not sent to OneLedger" : "Saved on this phone"}
          </Text>
          <Text variant="label" color={transaction.sync_state === "failed" ? "attention" : "textSecondary"}>
            {transaction.sync_state === "failed"
              ? `${explainError(transaction.sync_error ?? null)} Open Sync to retry or discard it.`
              : "It will sync when you're online. Until then it isn't confirmed by OneLedger."}
          </Text>
        </Card>
      ) : null}

      {payOffer ? (
        <Button
          label={`Pay ${payOffer.target.name ?? "this recipient"} again`}
          fullWidth
          // Only the id travels: the form rebuilds the recipient from the
          // transaction itself, so a crafted deep link can't choose one.
          onPress={() =>
            router.push({ pathname: "/pay-again", params: { txn: transaction.id } })
          }
        />
      ) : null}

      {attention ? (
        <Card style={{ backgroundColor: colors.attentionBg }}>
          <Text variant="label" color="attention" accessibilityRole="alert">
            {attention}
          </Text>
        </Card>
      ) : null}

      <DuplicatesCard
        context={extras?.duplicates ?? null}
        reviewAction={duplicateReviewAction}
        onOpen={(txnId) => router.push({ pathname: "/transaction/[id]", params: { id: txnId } })}
      />

      {where.length > 0 ? (
        <Card style={{ gap: space[3] }}>
          <Text variant="caption" color="textMuted" accessibilityRole="header">
            WHERE THIS CAME FROM
          </Text>
          {where.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
        </Card>
      ) : null}

      <Card style={{ gap: space[3] }}>
        <Row label="Amount" value={money(transaction.amount_rwf)} />
        {transaction.fee_rwf > 0 ? <Row label="Fee" value={money(transaction.fee_rwf)} /> : null}
        <Row label="Direction" value={directionLabel(transaction.direction)} />
        {transaction.balance_after_rwf !== null ? (
          <Row label="Balance after" value={money(transaction.balance_after_rwf)} />
        ) : null}
        <Row label="Type" value={transaction.transaction_type.replace(/_/g, " ")} />
        {transaction.counterparty_reference ? (
          <Row label="Reference" value={transaction.counterparty_reference} />
        ) : null}
      </Card>

      <ReceiptCard transactionId={transaction.id} />

      <GuideAnchor id="transaction-category"><Card style={{ gap: space[2] }}>
        <Text variant="caption" color="textMuted" accessibilityRole="header">
          CATEGORY
        </Text>
        <Text variant="bodyStrong">
          {transaction.category ?? "Uncategorized"}
          {transaction.subcategory ? ` · ${transaction.subcategory}` : ""}
        </Text>
        {needsReview(transaction) && transaction.suggested_category ? (
          <Row label="Suggested" value={transaction.suggested_category} />
        ) : null}
        <Text variant="label" color="textMuted">
          {categoryReason(latestReason, context?.categorySource ?? null)}
        </Text>

        {failed ? null : (
          <Button
            label={transaction.category ? "Change category" : "Choose a category"}
            fullWidth
            onPress={() =>
              router.push({ pathname: "/category/[id]", params: { id: transaction.id } })
            }
          />
        )}

        {history.length > 1 ? (
          <View style={{ gap: space[2], marginTop: space[2] }}>
            <Text variant="caption" color="textMuted" accessibilityRole="header">
              CATEGORY HISTORY
            </Text>
            {history.map((entry) => {
              const line = historyLine(entry);
              return (
                <Text key={entry.id} variant="label" color="textMuted">
                  <Text variant="label">{line.change}</Text>
                  {` · ${line.actor} · ${formatFullDateTime(entry.created_at)}`}
                </Text>
              );
            })}
          </View>
        ) : null}
      </Card>

      </GuideAnchor>
      {context || (extras?.tags.length ?? 0) > 0 ? (
        <TransactionTags
          // A fresh editor per transaction (and per load), so edits never leak across.
          key={`${transaction.id}:${extras ? "loaded" : "pending"}`}
          transactionId={transaction.id}
          workspaceId={context?.workspaceId ?? null}
          initialTags={extras?.tags ?? []}
          suggestions={extras?.tagSuggestions ?? []}
        />
      ) : null}

      {extras?.attribution ? (
        <AttributionPanel
          // A fresh editor per transaction, so an earlier edit never leaks across.
          key={transaction.id}
          transactionId={transaction.id}
          current={extras.attribution}
          members={extras.members}
          selfUserId={extras.selfUserId}
          // The "needs attribution" banner above depends on it: reload once saved.
          onSaved={refreshExtras}
        />
      ) : null}

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
