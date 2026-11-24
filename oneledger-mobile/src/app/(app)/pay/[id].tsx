import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, Share, View } from "react-native";

import { fetchPayIntent, recordPayHandoff, settlePayIntent } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { PAY_COPY, stateLabel } from "@/features/pay/messages";
import { PaymentStatus } from "@/features/pay/PaymentStatus";
import { SaveOnPlanPanel } from "@/features/save-on/SaveOnPlanPanel";
import { formatLocalMsisdn } from "@/features/pay/target";
import { isStale, payPhase, POLL_MS, STALE_AFTER_MS } from "@/features/pay/status";
import type { PayIntent } from "@/features/pay/types";
import { useQuery } from "@/hooks/useQuery";
import { formatMoney, formatRwf } from "@/lib/money";
import { space } from "@/theme/tokens";

type Handoff = Parameters<typeof recordPayHandoff>[1];

/** The number the payment goes to, in full when the server sends it: the payer needs to see who they are paying. */
const recipientNumber = (intent: PayIntent) =>
  intent.recipientMsisdn ? formatLocalMsisdn(intent.recipientMsisdn) : intent.recipientMasked;

const amountText = (intent: PayIntent) =>
  intent.currency === "RWF"
    ? formatRwf(intent.amountMinor)
    : intent.currency === "EUR" || intent.currency === "USD"
      ? formatMoney(BigInt(Math.round(intent.amountMinor)), intent.currency)
      : `${intent.amountMinor} ${intent.currency}`;

// Review a prepared payment, open your phone's dialer with the code, then watch the
// result. OneLedger shows the code the server built from the published directory;
// you authorise it with your provider, on your own phone. Opening the dialer is only
// a hand-off: the screen shows a spinner until the provider's message confirms the
// payment (a blue tick) or it fails (a red cross), and never claims success before.
export default function PayReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => fetchPayIntent(id), [id]);
  const { data, loading, refresh } = useQuery(load);

  const [latest, setLatest] = useState<PayIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [settleError, setSettleError] = useState<string | null>(null);

  const intent = latest ?? (data?.ok ? data.intent : null);
  const phase = intent ? payPhase(intent.state) : null;

  // While it waits, ask the server every few seconds (when the app is in front),
  // so the mark flips by itself even if nothing else prompts a refresh.
  useEffect(() => {
    if (phase !== "waiting") return;
    let active = true;
    const tick = async () => {
      // Skip while the app is in the background (the next tick after it returns catches up).
      if (AppState.currentState === "background" || AppState.currentState === "inactive") return;
      setNow(Date.now());
      const result = await fetchPayIntent(id);
      if (active && result.ok) setLatest(result.intent);
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [phase, id]);

  if (!intent) {
    return (
      <Screen>
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
  const recipient = intent.recipientName ?? (intent.merchantCode ? `merchant ${intent.merchantCode}` : null);

  async function report(body: Handoff, keepNote?: string) {
    const result = await recordPayHandoff(intent!.id, body);
    if (result.ok) {
      setLatest(result.intent);
      setNow(Date.now());
      // A failure the user must see (the dialer didn't open) outranks the generic line.
      setNote(keepNote ?? null);
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

  // Only ever on an explicit tap, never automatically. iOS shows its own
  // "Call?" confirmation for the USSD code.
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

  async function settle(outcome: "sent" | "failed") {
    if (busy) return;
    setBusy(true);
    setSettleError(null);
    const result = await settlePayIntent(intent!.id, outcome);
    setBusy(false);
    if (result.ok) setLatest(result.intent);
    else setSettleError(result.message);
  }

  // A payment that is one part of a Save On plan also shows the whole plan.
  const panel = intent.splitPlanId ? (
    <SaveOnPlanPanel planId={intent.splitPlanId} currentIntentId={intent.id} refreshKey={intent.state} />
  ) : null;

  const summary = (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row" }}>
        <Badge variant="neutral">{stateLabel(intent.state)}</Badge>
      </View>
      <Text variant="title" tabular>
        {amountText(intent)}
      </Text>
      <Text variant="label" color="textSecondary">
        {intent.recipientName ?? (intent.merchantCode ? "Merchant" : "Recipient")}
        {recipientNumber(intent) ? ` · ${recipientNumber(intent)}` : ""}
        {intent.merchantCode ? ` · code ${intent.merchantCode}` : ""}
      </Text>
    </Card>
  );

  // The live result, once the payment has been handed off.
  if (phase) {
    const stale = phase === "waiting" && isStale(intent.updatedAt, now);
    return (
      <Screen>
        <ScreenHeader title="Payment status" />
        {summary}
        {panel}
        <Card>
          <PaymentStatus phase={phase} intent={intent} amountLabel={amountText(intent)} recipient={recipient} />
        </Card>

        {phase === "waiting" ? (
          <>
            {stale ? (
              <Card style={{ gap: space[2] }}>
                <Text variant="bodyStrong">Still waiting?</Text>
                <Text variant="label" color="textSecondary">
                  No message from your provider yet. If you finished the payment on your phone, tell us. We still
                  update this by ourselves when the provider&apos;s message arrives.
                </Text>
                <Button label="I sent it" fullWidth loading={busy} onPress={() => settle("sent")} />
                <Button label="It didn't go through" variant="secondary" fullWidth disabled={busy} onPress={() => settle("failed")} />
                {settleError ? (
                  <Text variant="caption" color="attention" accessibilityRole="alert">
                    {settleError}
                  </Text>
                ) : null}
              </Card>
            ) : (
              <Text variant="caption" color="textMuted" style={{ textAlign: "center" }}>
                {`If nothing changes within ${Math.round(STALE_AFTER_MS / 1000)} seconds you can tell us what happened.`}
              </Text>
            )}
            {instruction?.ok ? (
              <Button label="Open the dialer again" variant="ghost" fullWidth disabled={busy} onPress={onDial} />
            ) : null}
          </>
        ) : (
          <View style={{ gap: space[2] }}>
            <Button label="Done" fullWidth onPress={() => router.back()} />
            {phase === "failure" ? (
              <Button label="Try again" variant="secondary" fullWidth onPress={() => router.replace("/pay-sheet")} />
            ) : null}
          </View>
        )}
        {note ? (
          <Text variant="label" color="textSecondary" accessibilityLiveRegion="polite">
            {note}
          </Text>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={PAY_COPY.reviewTitle} subtitle={PAY_COPY.feeNotice} />
      {summary}
      {panel}

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
          <Button label="Open phone dialer" fullWidth loading={busy} onPress={onDial} />
          <Button label="Share or copy code" variant="secondary" fullWidth disabled={busy} onPress={onShare} />
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
