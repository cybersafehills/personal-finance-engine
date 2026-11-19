import { useCallback, useState } from "react";
import { Alert, View } from "react-native";

import { Badge, Button, Card, Chip, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { formatLocalMsisdn } from "@/features/pay/target";
import {
  createTrustedRecipient,
  deleteTrustedRecipient,
  getTrustedRecipients,
  setRecipientTrust,
  type TrustedRecipient } from "@/features/pay/recipients";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

// Saved recipients, as on the web's /pay/recipients: people and merchants you pay
// often, so Pay can fill them in. "Trusted" is your own mark that you've checked
// the details; it never authorizes anything.
export default function Recipients() {
  const load = useCallback(() => getTrustedRecipients(), []);
  const { data, loading, error, refresh } = useQuery(load);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function toggleTrust(r: TrustedRecipient) {
    setNote((await setRecipientTrust(r.id, !r.trusted)) ? null : "Could not update the recipient.");
    refresh();
  }

  function confirmRemove(r: TrustedRecipient) {
    Alert.alert(`Remove ${r.name}?`, "They will no longer appear when you start a payment. Past payments are not affected.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setNote((await deleteTrustedRecipient(r.id)) ? null : "Could not remove the recipient.");
          refresh();
        } },
    ]);
  }

  return (
    <Screen>
      <ScreenHeader title="Saved recipients" subtitle="People and merchants you pay often." />

      {adding ? (
        <AddForm
          onDone={() => {
            setAdding(false);
            refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button label="Add a recipient" onPress={() => setAdding(true)} />
      )}
      {note ? (
        <Text variant="label" color="attention" accessibilityRole="alert">
          {note}
        </Text>
      ) : null}

      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : error && !data ? (
        <EmptyState title={error} action={<Button label="Try again" variant="secondary" onPress={refresh} />} />
      ) : data && data.length === 0 ? (
        <EmptyState title="No saved recipients yet" description="Add someone you pay often to fill them in faster." />
      ) : (
        (data ?? []).map((r) => (
          <Card key={r.id} style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              <Text variant="bodyStrong">{r.name}</Text>
              {r.trusted ? <Badge variant="positive">Trusted by you</Badge> : null}
            </View>
            <Text variant="label" color="textSecondary" tabular>
              {r.msisdn ? formatLocalMsisdn(r.msisdn) : r.merchantCode ? `Merchant code ${r.merchantCode}` : r.accountReference ? `Account ${r.accountReference}` : ""}
            </Text>
            <View style={{ flexDirection: "row", gap: space[2] }}>
              <Button
                label={r.trusted ? "Remove trust" : "Mark as trusted"}
                variant="secondary"
                accessibilityLabel={`${r.trusted ? "Remove trust from" : "Mark as trusted:"} ${r.name}`}
                onPress={() => toggleTrust(r)}
              />
              <Button label="Remove" variant="ghost" accessibilityLabel={`Remove ${r.name}`} onPress={() => confirmRemove(r)} />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

function AddForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<"phone" | "merchant">("phone");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [relationship, setRelationship] = useState("");
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const failure = await createTrustedRecipient({ name, kind, number, relationship, trusted });
    setBusy(false);
    if (failure) setError(failure);
    else onDone();
  }

  return (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", gap: space[2] }}>
        <Chip label="A person" selected={kind === "phone"} onPress={() => setKind("phone")} />
        <Chip label="A merchant" selected={kind === "merchant"} onPress={() => setKind("merchant")} />
      </View>
      <TextField label="Name" value={name} onChangeText={setName} editable={!busy} />
      <TextField
        label={kind === "phone" ? "Mobile number" : "Merchant code"}
        value={number}
        onChangeText={setNumber}
        keyboardType="phone-pad"
        editable={!busy}
      />
      <TextField label="Relationship (optional)" value={relationship} onChangeText={setRelationship} editable={!busy} />
      <Chip label="Mark as trusted by me" selected={trusted} onPress={() => setTrusted(!trusted)} />
      {error ? (
        <Text variant="label" color="attention" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label="Save recipient" fullWidth loading={busy} onPress={save} />
      <Button label="Cancel" variant="ghost" onPress={onCancel} />
    </Card>
  );
}
