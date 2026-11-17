import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { createPayIntent } from "@/api/mobile-api";
import { Button, Card, Chip, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { createKeyTracker } from "@/features/pay/key";
import { PAY_COPY } from "@/features/pay/messages";
import { parseRecipient, type PayKind } from "@/features/pay/new-form";
import { loadPayableAccounts } from "@/features/pay/payment-accounts";
import { formatLocalMsisdn } from "@/features/pay/target";
import { getRecentRecipients, getTrustedRecipients, recentsFor, recipientsFor } from "@/features/pay/recipients";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

const MAX_RWF = 999_999_999;

function parseAmountRwf(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 && n <= MAX_RWF ? n : null;
}

// Start a payment from the Pay button: who, from which account, how much. Like
// "Pay X again" it only prepares a draft; the next screen shows the code to dial
// and nothing is charged or sent from here. The type is read from the route but
// anything other than the two supported kinds shows nothing to pay.
export default function PayNew() {
  const params = useLocalSearchParams<{ type?: string }>();
  const kind: PayKind | null =
    params.type === "pay_person" || params.type === "pay_merchant" ? params.type : null;

  const load = useCallback(async () => (kind ? loadPayableAccounts(kind) : []), [kind]);
  const { data: accounts, loading, error } = useQuery(load);

  // Saved and recent recipients are a convenience: if they can't be read the form still works by typing.
  const loadPeople = useCallback(async () => {
    if (!kind) return { saved: [], recent: [] };
    const [saved, recent] = await Promise.all([
      getTrustedRecipients().catch(() => []),
      getRecentRecipients().catch(() => []),
    ]);
    return { saved: recipientsFor(kind, saved), recent: recentsFor(kind, recent) };
  }, [kind]);
  const { data: people } = useQuery(loadPeople);

  const tracker = useRef(createKeyTracker()).current;
  const inFlight = useRef(false);
  const [recipientText, setRecipientText] = useState("");
  const [name, setName] = useState("");
  const [amountText, setAmountText] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The first account that can do the job is preselected (like the web form).
  const chosenId = accounts?.find((a) => a.id === accountId)?.id ?? accounts?.[0]?.id ?? null;

  const cancel = <Button label="Cancel" variant="ghost" onPress={() => router.back()} />;

  if (!kind) {
    return (
      <Screen>
        {cancel}
        <EmptyState title="Nothing to pay here" description="Open Pay and choose a person or a merchant." />
      </Screen>
    );
  }

  const person = kind === "pay_person";

  async function submit() {
    if (inFlight.current || !kind) return;
    setMessage(null);
    const recipient = parseRecipient(kind, recipientText);
    if (!recipient.ok) return setMessage(recipient.message);
    const amount = parseAmountRwf(amountText);
    if (amount === null) return setMessage("Enter an amount greater than zero, in whole RWF.");
    if (!chosenId) return setMessage("Choose the account to pay from.");

    inFlight.current = true;
    setSubmitting(true);
    const key = tracker.keyFor([kind, recipient.msisdn ?? recipient.merchantCode, chosenId, amount].join("|"));
    const result = await createPayIntent({
      paymentType: kind,
      amountMinor: amount,
      idempotencyKey: key,
      recipientName: name.trim() || undefined,
      recipientMsisdn: recipient.msisdn,
      merchantCode: recipient.merchantCode,
      sourceAccountId: chosenId,
    });
    inFlight.current = false;
    setSubmitting(false);
    if (!result.ok) return setMessage(result.message);
    router.replace({ pathname: "/pay/[id]", params: { id: result.intent.id } });
  }

  return (
    <Screen>
      {cancel}
      <ScreenHeader title={person ? "Pay a person" : "Pay a merchant"} subtitle={PAY_COPY.feeNotice} />

      {people && people.saved.length > 0 ? (
        <Card style={{ gap: space[2] }}>
          <Text variant="caption" color="textMuted">
            Saved recipients
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {people.saved.map((r) => (
              <Chip
                key={r.id}
                label={r.trusted ? `${r.name} (trusted)` : r.name}
                selected={recipientText === (r.msisdn ? formatLocalMsisdn(r.msisdn) : r.merchantCode ?? "")}
                onPress={() => {
                  setRecipientText(r.msisdn ? formatLocalMsisdn(r.msisdn) : r.merchantCode ?? "");
                  setName(r.name);
                }}
              />
            ))}
          </View>
        </Card>
      ) : null}

      <TextField
        label={person ? "Mobile number" : "Merchant code"}
        value={recipientText}
        onChangeText={setRecipientText}
        keyboardType="phone-pad"
        placeholder={person ? "078 123 4567" : "e.g. 123456"}
        editable={!submitting}
      />
      <TextField
        label="Name (optional)"
        value={name}
        onChangeText={setName}
        placeholder={person ? "Who is this?" : "Business name"}
        editable={!submitting}
      />

      {people && people.recent.length > 0 ? (
        <View style={{ gap: space[1] }}>
          <Text variant="caption" color="textMuted">
            Recent (fills the name; type the number to check it)
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {people.recent.map((r, i) => (
              <Chip key={`${r.name}-${i}`} label={r.name} selected={name === r.name} onPress={() => setName(r.name)} />
            ))}
          </View>
        </View>
      ) : null}

      <Card style={{ gap: space[2] }}>
        <Text variant="caption" color="textMuted">
          Pay from
        </Text>
        {loading && !accounts ? (
          <Text variant="label" color="textMuted">
            Loading…
          </Text>
        ) : error ? (
          <Text variant="label" color="attention">
            Couldn&apos;t load your accounts. Go back and try again.
          </Text>
        ) : accounts && accounts.length === 0 ? (
          <Text variant="label" color="textSecondary">
            {person
              ? "You need a mobile-money account in OneLedger to prepare a payment."
              : "Merchant payments need an MTN MoMo account in OneLedger."}
          </Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {(accounts ?? []).map((a) => (
              <Chip key={a.id} label={a.name} selected={a.id === chosenId} onPress={() => setAccountId(a.id)} />
            ))}
          </View>
        )}
      </Card>

      <TextField
        label="Amount (RWF)"
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="number-pad"
        placeholder="e.g. 5000"
        returnKeyType="done"
        error={message ?? undefined}
        editable={!submitting}
      />

      <Text variant="caption" color="textMuted">
        {PAY_COPY.handoffNotice}
      </Text>

      <Button
        label="Prepare payment"
        fullWidth
        loading={submitting}
        disabled={!accounts || accounts.length === 0}
        onPress={submit}
      />
    </Screen>
  );
}
