import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";

import { createPayIntent } from "@/api/mobile-api";
import { Button, Card, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { createKeyTracker } from "@/features/pay/key";
import { PAY_COPY } from "@/features/pay/messages";
import { maskMsisdn, normalizeRwandaMsisdn } from "@/features/pay/target";
import { space } from "@/theme/tokens";

const MERCHANT_CODE = /^\d{3,12}$/;
const MAX_RWF = 999_999_999;

/** Whole RWF from what was typed ("5,000" or "5 000"), or null when it isn't a usable amount. */
function parseAmountRwf(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 && n <= MAX_RWF ? n : null;
}

// Prepare a payment to someone you've paid before. The recipient comes from the
// transaction and is shown, never edited here; the amount is deliberately NOT
// prefilled (paying the same amount again should be a decision). Nothing is
// charged: this creates a draft, and the next screen shows the code to dial.
export default function PayAgain() {
  const params = useLocalSearchParams<{
    type?: string;
    recipient?: string;
    name?: string;
    accountId?: string;
    accountName?: string;
  }>();
  const tracker = useRef(createKeyTracker()).current;
  const inFlight = useRef(false);

  const [amountText, setAmountText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const back = <Button label="Cancel" variant="ghost" onPress={() => router.back()} />;

  const type = params.type === "pay_person" || params.type === "pay_merchant" ? params.type : null;
  const recipient = params.recipient ?? "";
  const msisdn = type === "pay_person" ? normalizeRwandaMsisdn(recipient) : null;
  const merchantCode = type === "pay_merchant" && MERCHANT_CODE.test(recipient) ? recipient : null;
  const accountId = params.accountId || undefined;
  const name = params.name?.trim() || undefined;

  if (!type || (!msisdn && !merchantCode) || (type === "pay_merchant" && !accountId)) {
    return (
      <Screen>
        {back}
        <EmptyState
          title="We can't prepare this payment"
          description="Open the transaction and try again."
        />
      </Screen>
    );
  }

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
    const key = tracker.keyFor([type, msisdn ?? merchantCode, accountId ?? "", amount].join("|"));
    const result = await createPayIntent({
      paymentType: type!,
      amountMinor: amount,
      idempotencyKey: key,
      recipientName: name,
      recipientMsisdn: msisdn ?? undefined,
      merchantCode: merchantCode ?? undefined,
      sourceAccountId: accountId,
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
      {back}
      <ScreenHeader
        title={type === "pay_person" ? "Pay a person" : "Pay a business"}
        subtitle={PAY_COPY.feeNotice}
      />

      <Card style={{ gap: space[2] }}>
        <Text variant="caption" color="textMuted">
          Recipient
        </Text>
        <Text variant="heading">{name ?? (msisdn ? "This number" : "This merchant")}</Text>
        <Text variant="label" color="textSecondary" tabular>
          {msisdn ? maskMsisdn(msisdn) : `Merchant code ${merchantCode}`}
        </Text>
        {params.accountName ? (
          <Text variant="label" color="textMuted">
            Pay from {params.accountName}
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
