import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, Share, View } from "react-native";

import { fetchPayIntent, recordPayHandoff } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { PAY_COPY, stateLabel } from "@/features/pay/messages";
import type { PayIntent } from "@/features/pay/types";
import { useQuery } from "@/hooks/useQuery";
import { formatMoney, formatRwf } from "@/lib/money";
import { space } from "@/theme/tokens";

type Handoff = Parameters<typeof recordPayHandoff>[1];

const amountText = (intent: PayIntent) =>
  intent.currency === "RWF"
    ? formatRwf(intent.amountMinor)
    : intent.currency === "EUR" || intent.currency === "USD"
      ? formatMoney(BigInt(Math.round(intent.amountMinor)), intent.currency)
      : `${intent.amountMinor} ${intent.currency}`;

// Review a prepared payment and hand it off to your own phone. OneLedger shows
// the code the server built from the published directory; you authorise it with
// your provider. Nothing here claims the payment went through - opening the
// dialer or sharing the code is only recorded as a hand-off.
export default function PayReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => fetchPayIntent(id), [id]);
  const { data, loading, refresh } = useQuery(load);

  const [handedOff, setHandedOff] = useState<PayIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const back = <Button label="Back" variant="ghost" onPress={() => router.back()} />;

  const intent = handedOff ?? (data?.ok ? data.intent : null);

  if (!intent) {
    return (
      <Screen>
        {back}
        {loading && !data ? (
          <Text variant="label" color="textMuted">
            Loading…
          </Text>
        ) : (
          <EmptyState
            title={data && !data.ok ? data.message : "That payment couldn't be found."}
            action={
              data && !data.ok && data.reason === "not_found" ? undefined : (
                <Button label="Try again" variant="secondary" onPress={refresh} />
              )
            }
          />
        )}
      </Screen>
    );
  }

  const instruction = intent.instruction;

  async function report(body: Handoff, keepNote?: string) {
    const result = await recordPayHandoff(intent!.id, body);
    if (result.ok) {
      setHandedOff(result.intent);
      // A failure the user must see (the dialer didn't open) outranks the generic line.
      setNote(keepNote ?? PAY_COPY.afterHandoff);
    } else {
      setNote("Couldn't record that. Your payment isn't affected.");
    }
  }

  async function onShare() {
    if (!instruction?.ok || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await Share.share({ message: instruction.display });
      // On iPhone only a completed share counts (a dismissed sheet is reported).
      // Android always reports "shared", so there a dismissed sheet is recorded
      // too: the web records a copy click the same way, and a hand-off is only
      // ever "awaiting verification", never a claim that anything was paid.
      if (result.action === Share.sharedAction) await report({ method: "copy", outcome: "copied" });
    } catch {
      setNote("Couldn't open the share sheet. Select the code above and copy it.");
    } finally {
      setBusy(false);
    }
  }

  // Only ever on an explicit tap, never automatically.
  async function onDial() {
    if (!instruction?.ok || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await Linking.openURL(instruction.telHref);
      await report({ method: "dialer", outcome: "dialer_opened" });
    } catch {
      await report({ method: "dialer", outcome: "dialer_unsupported" }, PAY_COPY.dialerFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      {back}
      <ScreenHeader title={PAY_COPY.reviewTitle} subtitle={PAY_COPY.feeNotice} />

      <Card style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row" }}>
          <Badge variant="neutral">{stateLabel(intent.state)}</Badge>
        </View>
        <Text variant="title" tabular>
          {amountText(intent)}
        </Text>
        <Text variant="label" color="textSecondary">
          {intent.recipientName ?? (intent.merchantCode ? "Merchant" : "Recipient")}
          {intent.recipientMasked ? ` · ${intent.recipientMasked}` : ""}
          {intent.merchantCode ? ` · code ${intent.merchantCode}` : ""}
        </Text>
      </Card>

      {instruction === null ? (
        <EmptyState title="No verified route yet" description={PAY_COPY.noRoute} />
      ) : !instruction.ok ? (
        <Card style={{ gap: space[2] }}>
          <Text variant="bodyStrong">We can&apos;t build the code</Text>
          <Text variant="label" color="attention">
            {instruction.error}
          </Text>
        </Card>
      ) : (
        <Card style={{ gap: space[3] }}>
          <Text variant="caption" color="textMuted">
            Code to dial
          </Text>
          <Text variant="heading" tabular selectable accessibilityLabel={`Code to dial: ${instruction.display}`}>
            {instruction.display}
          </Text>
          <Text variant="caption" color="textMuted">
            {PAY_COPY.handoffNotice}
          </Text>
          <Button label="Share or copy code" variant="secondary" fullWidth loading={busy} onPress={onShare} />
          {Platform.OS === "android" ? (
            <Button label="Open phone dialer" fullWidth disabled={busy} onPress={onDial} />
          ) : (
            <Text variant="caption" color="textSecondary">
              {PAY_COPY.iosHint}
            </Text>
          )}
        </Card>
      )}

      {note ? (
        <Text variant="label" color="textSecondary" accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
    </Screen>
  );
}
