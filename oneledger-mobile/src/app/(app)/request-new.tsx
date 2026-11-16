import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useState } from "react";
import { Share, View } from "react-native";

import { Button, Card, Chip, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { createRequest } from "@/features/requests/actions";
import {
  CURRENCIES,
  EXPIRY_CHOICES,
  buildCreateBody,
  newIdempotencyKey,
  parseAmount,
  shareMessage,
  validateInput,
  type CreateInput,
  type FieldErrors,
} from "@/features/requests/input";
import { formatMoney, type SupportedCurrency } from "@/lib/money";
import { space } from "@/theme/tokens";

// Create a payment request and share its link. The link is created on the
// server and shown ONCE - it can't be shown again, so share it from here (or
// cancel the request and make a new one). OneLedger doesn't collect or verify
// the payment.

type Done = { id: string; url: string | null; message: string };

export default function RequestNew() {
  // One key per opened form: a double tap or a retry creates ONE request.
  const [key] = useState(() => newIdempotencyKey((n) => Crypto.getRandomBytes(n)));
  const [input, setInput] = useState<CreateInput>({
    amountText: "", currency: "RWF", destinationType: "momo_phone", destination: "", name: "", reference: "", expiresInHours: 168,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const set = <K extends keyof CreateInput>(k: K, v: CreateInput[K]) => setInput((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (busy) return;
    const e = validateInput(input);
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length > 0) return;
    const body = buildCreateBody(input, key);
    if (!body) return;
    setBusy(true);
    const res = await createRequest(body);
    setBusy(false);
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    const minor = parseAmount(input.amountText, input.currency) ?? BigInt(0);
    setDone({
      id: res.id,
      url: res.url,
      message: res.url ? shareMessage({ amountText: formatMoney(minor, input.currency), name: input.name.trim(), url: res.url }) : "",
    });
  }

  if (done) {
    return (
      <Screen>
        <ScreenHeader title={done.url ? "Your link is ready" : "Already created"} />
        {done.url ? (
          <>
            <Card style={{ gap: space[2] }}>
              <Text variant="label" color="attention">
                This is the only time the link is shown. Share it now. If you lose it, cancel the request and make a new one.
              </Text>
              <Text variant="label" selectable>
                {done.url}
              </Text>
            </Card>
            <Button
              label="Share link"
              fullWidth
              onPress={() => {
                Share.share({ message: done.message }).catch(() => undefined);
              }}
            />
          </>
        ) : (
          <Card>
            <Text variant="label" color="textSecondary">
              This request was already created, so its link cannot be shown again. Cancel it and make a new one if you need a fresh link.
            </Text>
          </Card>
        )}
        <Text variant="caption" color="textMuted">
          OneLedger does not collect or verify the payment. When the money arrives, open the request and link the payment (or mark it paid yourself).
        </Text>
        <Button label="View this request" variant="secondary" fullWidth onPress={() => router.replace({ pathname: "/request/[id]", params: { id: done.id } })} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <ScreenHeader title="New payment request" />

      <TextField label="Amount" value={input.amountText} onChangeText={(t) => set("amountText", t)} keyboardType="decimal-pad" autoComplete="off" error={errors.amount} />
      <View style={{ flexDirection: "row", gap: space[2] }}>
        {CURRENCIES.map((c: SupportedCurrency) => (
          <Chip key={c} label={c} selected={input.currency === c} onPress={() => set("currency", c)} />
        ))}
      </View>

      <Text variant="label" color="textSecondary">
        Where should it be sent?
      </Text>
      <View style={{ flexDirection: "row", gap: space[2] }}>
        <Chip label="Mobile Money number" selected={input.destinationType === "momo_phone"} onPress={() => set("destinationType", "momo_phone")} />
        <Chip label="Merchant code" selected={input.destinationType === "merchant_code"} onPress={() => set("destinationType", "merchant_code")} />
      </View>
      <TextField
        label={input.destinationType === "momo_phone" ? "Mobile Money number" : "Merchant code"}
        value={input.destination}
        onChangeText={(t) => set("destination", t)}
        keyboardType="phone-pad"
        autoComplete="off"
        error={errors.destination}
      />

      <TextField label="Name the payer will see" value={input.name} onChangeText={(t) => set("name", t)} maxLength={80} error={errors.name} />
      <TextField label="Reference (optional)" value={input.reference} onChangeText={(t) => set("reference", t)} maxLength={64} error={errors.reference} />

      <Text variant="label" color="textSecondary">
        Valid for
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {EXPIRY_CHOICES.map((x) => (
          <Chip key={x.hours} label={x.label} selected={input.expiresInHours === x.hours} onPress={() => set("expiresInHours", x.hours)} />
        ))}
      </View>

      <Text variant="caption" color="textMuted">
        The payer sees the name and number above, with a note that OneLedger does not verify them or the payment. Double-check the number - money sent to a wrong number may not be recoverable.
      </Text>
      {formError ? (
        <Text variant="label" color="attention" accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}
      <Button label="Create request" loading={busy} onPress={submit} fullWidth />
    </Screen>
  );
}
