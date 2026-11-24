import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { createPayIntent, fetchSaveOnOffer, startSaveOn } from "@/api/mobile-api";
import { getPaymentTemplate } from "@/features/pay/activity";
import { getPayConfigCache } from "@/features/pay/config-cache";
import { SAVE_ON } from "@/features/save-on/messages";
import { SaveOnOfferCard } from "@/features/save-on/SaveOnOfferCard";
import type { SaveOnOffer } from "@/features/save-on/types";
import { Button, Chip, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { ContactPickButton, SaveContactToggle } from "@/features/pay/ContactControls";
import { posterPrefill } from "@/features/scan/poster";
import { createKeyTracker } from "@/features/pay/key";
import { PAY_COPY } from "@/features/pay/messages";
import { parseRecipient, type PayKind } from "@/features/pay/new-form";
import { loadPayableAccounts } from "@/features/pay/payment-accounts";
import { formatLocalMsisdn } from "@/features/pay/target";
import {
  createTrustedRecipient,
  getRecentRecipients,
  getTrustedRecipients,
  recentsFor,
  recentsNotSaved,
  recipientsFor,
} from "@/features/pay/recipients";
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
  const params = useLocalSearchParams<{ type?: string; saved?: string; template?: string; to?: string; name?: string; merchantCode?: string; merchantName?: string }>();
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
  const [recipientText, setRecipientText] = useState(() => posterPrefill(params).merchantCode);
  const [name, setName] = useState(() => posterPrefill(params).name);
  const [amountText, setAmountText] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  // "Save as contact": the number/code is kept under Saved contacts (People and merchants) after the draft is prepared.
  const [saveContact, setSaveContact] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Why a phone contact could not be used: shown under the number it was meant to fill.
  const [contactProblem, setContactProblem] = useState<string | null>(null);

  // Opened from a payment template: fill the recipient and the usual amount once.
  // (A template keeps only a masked phone number, so for a person the full number
  // comes from the saved contact it was linked to; otherwise it is left to type.)
  const loadTemplate = useCallback(async () => {
    if (!params.template) return null;
    const t = await getPaymentTemplate(params.template).catch(() => null);
    if (!t) return null;
    const contact = t.trustedRecipientId ? (await getTrustedRecipients().catch(() => [])).find((r) => r.id === t.trustedRecipientId) : undefined;
    return { template: t, contact };
  }, [params.template]);
  const { data: tpl } = useQuery(loadTemplate);
  const [templateApplied, setTemplateApplied] = useState(false);
  if (!templateApplied && tpl) {
    setTemplateApplied(true);
    const { template, contact } = tpl;
    const number = contact?.msisdn ? formatLocalMsisdn(contact.msisdn) : (contact?.merchantCode ?? template.merchantCode ?? "");
    if (number) setRecipientText(number);
    setName(contact?.name ?? template.recipientName ?? "");
    if (template.defaultAmountMinor) setAmountText(String(template.defaultAmountMinor));
  }

  // Opened from a person's page ("Pay this person"): their number or code and name, once.
  const [linkApplied, setLinkApplied] = useState(false);
  if (!linkApplied && (params.to || params.name) && !params.saved && !params.template) {
    setLinkApplied(true);
    if (params.to) setRecipientText(params.to);
    if (params.name) setName(params.name);
  }

  // Opened from a saved contact: fill its number and name once.
  if (!prefilled && people && params.saved) {
    const found = people.saved.find((r) => r.id === params.saved);
    setPrefilled(true);
    if (found) {
      setRecipientText(found.msisdn ? formatLocalMsisdn(found.msisdn) : (found.merchantCode ?? ""));
      setName(found.name);
    }
  }

  // The first account that can do the job is preselected (like the web form).
  const chosenId = accounts?.find((a) => a.id === accountId)?.id ?? accounts?.[0]?.id ?? null;

  // Save On: whether the person chose to send over eKash, and the server's offer for this
  // amount. The server decides the parts; nothing is computed here. Hidden unless the
  // server says Save On is on for this user.
  const splitsOn = getPayConfigCache()?.paySplits === true;
  const [overEkash, setOverEkash] = useState(false);
  const [offerFor, setOfferFor] = useState<{ key: string; offer: SaveOnOffer | null } | null>(null);
  const [saveOnBusy, setSaveOnBusy] = useState(false);
  const typedAmount = parseAmountRwf(amountText);
  const offerKey =
    splitsOn && kind && typedAmount !== null ? JSON.stringify([kind, overEkash, chosenId, recipientText, typedAmount]) : null;
  const offer = offerKey !== null && offerFor?.key === offerKey ? offerFor.offer : null;
  useEffect(() => {
    if (offerKey === null || !kind || typedAmount === null) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const r = parseRecipient(kind, recipientText);
      const res = await fetchSaveOnOffer({
        paymentType: kind,
        amountMinor: typedAmount,
        networkSlug: overEkash ? "ekash" : undefined,
        sourceAccountId: chosenId ?? undefined,
        recipientMsisdn: r.ok ? r.msisdn : undefined,
      });
      // A suggestion is never worth failing the form for: any failure is simply "no offer".
      if (!cancelled) setOfferFor({ key: offerKey, offer: res.ok ? res.offer : null });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerKey]);


  if (!kind) {
    return (
      <Screen>
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
    if (saveContact && !name.trim()) return setMessage("Add a name to save this contact, or turn saving off.");

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
    // Keep the contact (best effort: a duplicate or a write that is switched off never blocks the payment).
    if (saveContact) {
      void createTrustedRecipient({
        name,
        kind: person ? "phone" : "merchant",
        number: recipient.msisdn ? `0${recipient.msisdn.slice(3)}` : (recipient.merchantCode ?? ""),
        trusted: false,
      });
    }
    router.replace({ pathname: "/pay/[id]", params: { id: result.intent.id } });
  }

  // Start the split: the plan and part 1 (an ordinary draft). Nothing is charged or sent.
  async function onSaveOn() {
    if (inFlight.current || !kind) return;
    setMessage(null);
    const recipient = parseRecipient(kind, recipientText);
    if (!recipient.ok) return setMessage(recipient.message);
    const amount = parseAmountRwf(amountText);
    if (amount === null) return setMessage("Enter an amount greater than zero, in whole RWF.");
    if (!chosenId) return setMessage("Choose the account to pay from.");
    inFlight.current = true;
    setSaveOnBusy(true);
    const key = tracker.keyFor(["save-on", kind, recipient.msisdn ?? recipient.merchantCode, chosenId, amount, overEkash].join("|"));
    const result = await startSaveOn({
      paymentType: kind,
      amountMinor: amount,
      idempotencyKey: key,
      recipientName: name.trim() || undefined,
      recipientMsisdn: recipient.msisdn,
      merchantCode: recipient.merchantCode,
      sourceAccountId: chosenId,
      networkSlug: overEkash ? "ekash" : undefined,
    });
    inFlight.current = false;
    setSaveOnBusy(false);
    if (!result.ok) return setMessage(result.message);
    router.replace({ pathname: "/pay/[id]", params: { id: result.intent.id } });
  }

  const onlyAccount = accounts && accounts.length === 1 ? accounts[0] : null;

  return (
    <Screen>
      <ScreenHeader title={person ? "Pay a person" : "Pay a merchant"} subtitle={PAY_COPY.feeNotice} />

      {people && people.saved.length > 0 ? (
        <View style={{ gap: space[1] }}>
          <Text variant="caption" color="textMuted">
            Saved contacts
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }} keyboardShouldPersistTaps="handled">
            {people.saved.map((r) => (
              <Chip
                key={r.id}
                label={r.trusted ? `${r.name} (trusted)` : r.name}
                selected={recipientText === (r.msisdn ? formatLocalMsisdn(r.msisdn) : (r.merchantCode ?? ""))}
                onPress={() => {
                  setRecipientText(r.msisdn ? formatLocalMsisdn(r.msisdn) : (r.merchantCode ?? ""));
                  setName(r.name);
                  setSaveContact(false);
                }}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <TextField
        label={person ? "Mobile number" : "Merchant code"}
        value={recipientText}
        onChangeText={(t) => {
          setRecipientText(t);
          setContactProblem(null);
        }}
        error={contactProblem ?? undefined}
        keyboardType="phone-pad"
        placeholder={person ? "078 123 4567" : "e.g. 123456"}
        editable={!submitting}
        // A merchant code isn't something a phone contact holds, so the contact book is for people.
        trailing={
          person ? (
            <ContactPickButton
              onPicked={(c) => {
                setRecipientText(c.number);
                // The saved name fills in, and can still be changed before paying.
                if (c.name) setName(c.name);
                setSaveContact(false);
                setContactProblem(null);
                setMessage(null);
              }}
              onProblem={setContactProblem}
            />
          ) : undefined
        }
      />

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

      <TextField
        label="Name (optional)"
        value={name}
        onChangeText={setName}
        placeholder={person ? "Who is this?" : "Business name"}
        editable={!submitting}
        trailing={<SaveContactToggle value={saveContact} onChange={setSaveContact} />}
        help={saveContact ? "This contact will be saved under People and merchants." : undefined}
      />

      {people && recentsNotSaved(people.recent, people.saved).length > 0 ? (
        <View style={{ gap: space[1] }}>
          <Text variant="caption" color="textMuted">
            Recent
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }} keyboardShouldPersistTaps="handled">
            {recentsNotSaved(people.recent, people.saved).map((r, i) => (
              <Chip key={`${r.name}-${i}`} label={r.name} selected={name === r.name} onPress={() => setName(r.name)} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {loading && !accounts ? (
        <Text variant="label" color="textMuted">
          Loading your accounts…
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
      ) : onlyAccount ? (
        <Text variant="label" color="textMuted">
          Paying from {onlyAccount.name}
        </Text>
      ) : (
        <View style={{ gap: space[1] }}>
          <Text variant="caption" color="textMuted">
            Pay from
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
            {(accounts ?? []).map((a) => (
              <Chip key={a.id} label={a.name} selected={a.id === chosenId} onPress={() => setAccountId(a.id)} />
            ))}
          </ScrollView>
        </View>
      )}

      {splitsOn ? (
        <View style={{ gap: space[1] }}>
          <View style={{ flexDirection: "row" }}>
            <Chip label={SAVE_ON.ekashChoice} selected={overEkash} onPress={() => setOverEkash((v) => !v)} />
          </View>
          <Text variant="caption" color="textMuted">
            {SAVE_ON.ekashHint}
          </Text>
        </View>
      ) : null}

      {offer ? <SaveOnOfferCard offer={offer} busy={saveOnBusy} onAccept={onSaveOn} onLearnMore={() => router.push("/save-on")} /> : null}
      {splitsOn && !offer ? (
        <Button label={SAVE_ON.learnMore} variant="ghost" fullWidth onPress={() => router.push("/save-on")} />
      ) : null}

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
