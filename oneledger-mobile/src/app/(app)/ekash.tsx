import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import { useState } from "react";
import { Share, View } from "react-native";

import { Button, Card, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { buildEkashCode, ekashShareText } from "@/features/ussd/ekash";
import { colors, radii, space } from "@/theme/tokens";

// "Use eKash": send money to a bank account or a Mobile Money wallet through the
// eKash national network. Enter the receiver's ID (a phone number or an account
// number) and the amount; the code is built for you and opens in your dialer.
// It never dials by itself, and you approve it with your own PIN on your phone.
export default function Ekash() {
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const touched = receiver.trim() !== "" || amount.trim() !== "";
  const code = buildEkashCode(receiver, amount);
  const ready = code.ok ? code : null;

  async function onPay() {
    if (!ready) return;
    setNote(null);
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

      <Card style={{ gap: space[3] }}>
        <TextField
          label="Receiver's ID"
          value={receiver}
          onChangeText={setReceiver}
          placeholder="Phone number or account number"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="default"
        />
        <TextField label="Amount (RWF)" value={amount} onChangeText={setAmount} placeholder="5000" keyboardType="number-pad" />
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
        <Text
          variant="label"
          color="textMuted"
        >
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
