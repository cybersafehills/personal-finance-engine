import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { createPayIntent } from "@/api/mobile-api";
import { Button, Card, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { loadPayAgainOffer } from "@/features/pay/context";
import { createKeyTracker } from "@/features/pay/key";
import { PAY_COPY } from "@/features/pay/messages";
import { formatLocalMsisdn } from "@/features/pay/target";
import { getTransactionById } from "@/features/transactions/queries";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

const MAX_RWF = 999_999_999;

/** Whole RWF from what was typed ("5,000" or "5 000"), or null when it isn't a usable amount. */
function parseAmountRwf(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 && n <= MAX_RWF ? n : null;
}

// Prepare a payment to someone you've paid before. The ONLY thing this screen
// takes from its route is the transaction id: the recipient, name and paying
// account are rebuilt from that transaction (and re-checked) every time, so a
// crafted deep link can never open this form for a recipient of its choosing.
// The amount is deliberately not prefilled (paying the same amount again should
// be a decision). Nothing is charged: this creates a draft, and the next screen
// shows the code to dial.
export default function PayAgain() {
  const { txn } = useLocalSearchParams<{ txn?: string }>();
  const load = useCallback(async () => {
    if (!txn) return null;
    const transaction = await getTransactionById(txn);
    return transaction ? loadPayAgainOffer(transaction) : null;
  }, [txn]);
  const { data: offer, loading } = useQuery(load);

  const tracker = useRef(createKeyTracker()).current;
  const inFlight = useRef(false);
  const [amountText, setAmountText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);


  if (!offer) {
    return (
      <Screen>
        {loading ? (
          <Text variant="label" color="textMuted">
            Loading…
          </Text>
        ) : (
          <EmptyState
            title="We can't prepare this payment"
            description="Open the transaction and try again."
          />
        )}
      </Screen>
    );
  }

  const { target, account } = offer;
  const recipientKey = target.type === "pay_person" ? target.msisdn : target.merchantCode;

  async function submit() {
    if (inFlight.current) return; // a double tap is one request
    setError(null);
    const amount = parseAmountRwf(amountText);
    if (amount === null) {
      setError("Enter an amount greater than zero, in whole RWF.");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    // Same request = same id (a retry returns the same draft); an edited amount,
    // recipient or account is a new request and gets a new id.
    const key = tracker.keyFor([target.type, recipientKey, account?.id ?? "", amount].join("|"));
    const result = await createPayIntent({
      paymentType: target.type,
      amountMinor: amount,
      idempotencyKey: key,
      recipientName: target.name ?? undefined,
      recipientMsisdn: target.type === "pay_person" ? target.msisdn : undefined,
      merchantCode: target.type === "pay_merchant" ? target.merchantCode : undefined,
      sourceAccountId: account?.id,
    });
    inFlight.current = false;
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.replace({ pathname: "/pay/[id]", params: { id: result.intent.id } });
  }

  return (
    <Screen>
      <ScreenHeader
        title={target.type === "pay_person" ? "Pay a person" : "Pay a business"}
        subtitle={PAY_COPY.feeNotice}
      />

      <Card style={{ gap: space[2] }}>
        <Text variant="caption" color="textMuted">
          Recipient
        </Text>
        <Text variant="heading">
          {target.name ?? (target.type === "pay_person" ? "This number" : "This merchant")}
        </Text>
        {/* The whole number, not a masked one: this is the one place to check it before paying. */}
        <Text variant="label" color="textSecondary" tabular>
          {target.type === "pay_person"
            ? formatLocalMsisdn(target.msisdn)
            : `Merchant code ${target.merchantCode}`}
        </Text>
        {account ? (
          <Text variant="label" color="textMuted">
            Pay from {account.name}
          </Text>
        ) : null}
      </Card>

      <TextField
        label="Amount (RWF)"
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="number-pad"
        placeholder="e.g. 5000"
        returnKeyType="done"
        error={error ?? undefined}
        editable={!submitting}
      />

      <Text variant="caption" color="textMuted">
        {PAY_COPY.handoffNotice}
      </Text>

      <View style={{ gap: space[2] }}>
        <Button label="Prepare payment" fullWidth loading={submitting} onPress={submit} />
      </View>
    </Screen>
  );
}
