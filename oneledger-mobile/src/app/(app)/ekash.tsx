import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import { useCallback, useState } from "react";
import { ScrollView, Share, View } from "react-native";

import { Button, Card, Chip, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { ContactPickButton, SaveContactToggle } from "@/features/pay/ContactControls";
import { createTrustedRecipient, ekashRecipients, getTrustedRecipients } from "@/features/pay/recipients";
import { normalizeRwandaMsisdn } from "@/features/pay/target";
import { buildEkashCode, ekashShareText } from "@/features/ussd/ekash";
import { useQuery } from "@/hooks/useQuery";
import { colors, radii, space } from "@/theme/tokens";

// "Use eKash": send money to a bank account or a Mobile Money wallet through the
// eKash national network. Enter the receiver's ID (a phone number or an account
// number) and the amount, or pick someone you saved; the code is built for you and
// opens in your dialer. It never dials by itself, and you approve it with your own PIN.
export default function Ekash() {
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [saveContact, setSaveContact] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Saved contacts are a convenience: if they can't be read the page still works by typing.
  const loadContacts = useCallback(async () => ekashRecipients(await getTrustedRecipients().catch(() => [])), []);
  const { data: contacts } = useQuery(loadContacts);

  const touched = receiver.trim() !== "" || amount.trim() !== "";
  const code = buildEkashCode(receiver, amount);
  const ready = code.ok ? code : null;

  async function onPay() {
    if (!ready) return;
    setNote(null);
    if (saveContact) {
      if (!name.trim()) return setNote("Add a name to save this receiver, or turn saving off.");
      // Best effort: a duplicate, or a write that is switched off, never blocks the payment.
      void createTrustedRecipient({ name, kind: normalizeRwandaMsisdn(receiver) ? "phone" : "account", number: receiver.trim(), trusted: false });
    }
    try {
      await Linking.openURL(ready.telHref);
    } catch {
      setNote("We couldn't open your phone's dialer. Use “Share or copy code” and dial it yourself.");
    }
  }

  async function onShare() {
    if (!ready) return;
    try {
      await Share.share({ message: ekashShareText(ready.display, reference) });
    } catch {
      // Sharing cancelled: nothing to do.
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Use eKash" subtitle="Send to a bank account or Mobile Money wallet" />

      <View
        accessibilityRole="summary"
        style={{ flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: radii.control, backgroundColor: colors.ekashBg, borderWidth: 1, borderColor: colors.ekash }}
      >
        <View style={{ width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.ekash, alignItems: "center", justifyContent: "center" }}>
          <Feather name="repeat" size={16} color={colors.accentForeground} />
        </View>
        <Text variant="label" style={{ flex: 1, color: colors.ekashNavy }}>
          eKash is the national network behind Mobile Money and bank transfers, so the same code works for a wallet or a bank account.
        </Text>
      </View>

      {contacts && contacts.length > 0 ? (
        <View style={{ gap: space[1] }}>
          <Text variant="caption" color="textMuted">
            Saved contacts
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }} keyboardShouldPersistTaps="handled">
            {contacts.map((r) => (
              <Chip
                key={r.id}
                label={r.name}
                selected={receiver === r.receiverId}
                onPress={() => {
                  setReceiver(r.receiverId);
                  setName(r.name);
                  setSaveContact(false);
                }}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <Card style={{ gap: space[3] }}>
        <TextField
          label="Receiver's ID"
          value={receiver}
          onChangeText={setReceiver}
          placeholder="Phone number or account number"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="default"
          trailing={
            <ContactPickButton
              onPicked={(c) => {
                setReceiver(c.number);
                if (c.name) setName(c.name);
                setSaveContact(false);
                setNote(null);
              }}
              onProblem={setNote}
            />
          }
        />
        <TextField label="Amount (RWF)" value={amount} onChangeText={setAmount} placeholder="5000" keyboardType="number-pad" />
        <TextField
          label="Name (optional)"
          value={name}
          onChangeText={setName}
          placeholder="Who is this?"
          leading={<SaveContactToggle value={saveContact} onChange={setSaveContact} />}
          help={saveContact ? "This receiver will be saved to your contacts." : undefined}
        />
        <TextField
          label="Reference (optional)"
          value={reference}
          onChangeText={setReference}
          placeholder="What it's for"
          maxLength={60}
        />
        <Text variant="caption" color="textMuted">
          The reference is for you: it isn&apos;t part of the code, so it isn&apos;t sent to eKash. It is added when you share the details.
        </Text>
      </Card>

      <Card style={{ gap: space[3] }}>
        <Text variant="label" color="textMuted">
          Your code
        </Text>
        <Text
          variant="display"
          accessibilityLabel={ready ? `Code to dial: ${ready.display}` : "Code not ready yet"}
          style={{ fontSize: 26, lineHeight: 32, color: ready ? colors.ekashNavy : colors.textMuted }}
        >
          {ready ? ready.display : "*182*1*2*…*…#"}
        </Text>
        {!ready ? (
          <Text variant="label" color={touched ? "attention" : "textMuted"} accessibilityLiveRegion="polite">
            {touched && !code.ok ? code.error : "Enter the receiver's ID and the amount to get your code."}
          </Text>
        ) : null}
        <Button label="Pay with eKash" fullWidth disabled={!ready} onPress={onPay} />
        <Button label="Share or copy code" variant="secondary" fullWidth disabled={!ready} onPress={onShare} />
        <Text variant="caption" color="textMuted" style={{ textAlign: "center" }}>
          This opens your dialer with the code ready. You approve it with your provider, on your own phone. OneLedger never asks for your PIN.
        </Text>
        {note ? (
          <Text variant="caption" color="textSecondary" accessibilityRole="alert">
            {note}
          </Text>
        ) : null}
      </Card>
    </Screen>
  );
}
