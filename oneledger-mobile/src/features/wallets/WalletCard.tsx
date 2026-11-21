import { useState } from "react";
import { View } from "react-native";

import { Badge, Button, Card, Text, TextField } from "@/components/ds";
import { asOfText, balanceText, PROVIDER_LABEL, parseBalanceInput, reasonText, STATUS_LABEL, STATUS_MEANING, STATUS_VARIANT } from "@/features/wallets/display";
import { recordBalance } from "@/features/wallets/record";
import type { Wallet } from "@/features/wallets/types";
import { space } from "@/theme/tokens";

import { usePrivacy } from "@/features/privacy/PrivacyProvider";
export function WalletCard({ wallet: w, onSaved }: { wallet: Wallet; onSaved: () => void }) {
  const { amountsHidden } = usePrivacy();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decimals = w.currency === "RWF" ? 0 : 2;
  const asOf = asOfText(w);

  async function save() {
    const minor = parseBalanceInput(text, decimals);
    if (minor === null) {
      setError(decimals === 0 ? "Enter a whole number, like 78,900." : "Enter an amount, like 78,900.50.");
      return;
    }
    setBusy(true);
    setError(null);
    let res;
    try { res = await recordBalance({ accountId: w.id, amountMinor: minor }); }
    catch { setError("Couldn’t save your balance. Check your connection and try again."); return; }
    finally { setBusy(false); }
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setEditing(false);
    setText("");
    onSaved();
  }

  return (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
        <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
          {w.name}
        </Text>
        <Badge variant={STATUS_VARIANT[w.balance.status]}>{STATUS_LABEL[w.balance.status]}</Badge>
      </View>
      <Text variant="caption" color="textMuted">
        {PROVIDER_LABEL[w.provider] ?? "Wallet"}
        {w.isPrimary ? " · Main wallet" : ""}
      </Text>
      <Text variant="title" tabular accessibilityLabel={amountsHidden ? "Balance hidden" : `${amountsHidden ? "••••••" : balanceText(w)}, ${STATUS_LABEL[w.balance.status]}`}>
        {amountsHidden ? "••••••" : balanceText(w)}
      </Text>
      {asOf ? (
        <Text variant="caption" color="textMuted">
          {asOf}
        </Text>
      ) : null}
      <Text variant="label" color="textSecondary">
        {STATUS_MEANING[w.balance.status]}
      </Text>
      {w.balance.reasons.map((r) => (
        <Text key={r} variant="caption" color="textMuted">
          {reasonText(r)}
        </Text>
      ))}

      {editing ? (
        <View style={{ gap: space[2], marginTop: space[2] }}>
          <TextField
            label={`Your balance now (${w.currency})`}
            help="Check your provider's app or dial its USSD code, then type what it shows."
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            autoComplete="off"
            error={error ?? undefined}
          />
          <Button label="Save my balance" loading={busy} onPress={save} fullWidth />
          <Button label="Cancel" variant="ghost" onPress={() => { setEditing(false); setError(null); }} />
        </View>
      ) : (
        <Button label="I checked my balance" variant="secondary" onPress={() => setEditing(true)} />
      )}
    </Card>
  );
}
