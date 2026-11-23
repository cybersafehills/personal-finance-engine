import { useRef, useState } from "react";
import { View } from "react-native";

import { Button, Card, Text, TextField } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { getNewId } from "@/offline/ids";
import { space } from "@/theme/tokens";
import { contributionMinor } from "./contributions";
import { goalTypeLabel } from "./display";
import { archiveManagedGoal, createManagedGoal, removeGoalContribution, type GoalScope, type NewGoal } from "./management";
import type { Currency, GoalType } from "./types";

const TYPES: GoalType[] = ["general_savings", "emergency_fund", "planned_purchase", "investing", "debt"];
const CURRENCIES: Currency[] = ["RWF", "USD", "EUR"];

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function NewGoalControl({ scope, onSaved }: { scope: GoalScope; onSaved(): void }) {
  const { fullPrivacy } = usePrivacy();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState<Currency>("RWF");
  const [type, setType] = useState<GoalType>("general_savings");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const running = useRef(false);
  const draft = useRef<NewGoal | null>(null);
  const editable = !busy && !uncertain;

  async function submit() {
    if (running.current) return;
    let next = draft.current;
    if (!next) {
      const targetMinor = contributionMinor(amount, currency);
      if (!name.trim()) { setMessage("Give this goal a name."); return; }
      if (targetMinor === null) { setMessage(`Enter a positive target in ${currency} using the correct decimal places.`); return; }
      if (date && !isDate(date)) { setMessage("Enter a valid target date (YYYY-MM-DD), or leave it blank."); return; }
      next = {
        id: getNewId(), name: name.trim(), description: description.trim() || null,
        currency, type, targetMinor, targetDate: date || null,
      };
      draft.current = next;
    }
    running.current = true;
    setBusy(true);
    setMessage(null);
    const result = await createManagedGoal(scope, next);
    running.current = false;
    setBusy(false);
    if (result === "unconfirmed") {
      setUncertain(true);
      setMessage("Couldn’t confirm creation. Retry this request or review your goals before entering it again.");
      return;
    }
    if (result === "denied") {
      if (!uncertain) draft.current = null;
      setMessage("Couldn’t create the goal. Check your access to this Space.");
      return;
    }

    draft.current = null;
    setUncertain(false);
    setOpen(false);
    setName("");
    setDescription("");
    setAmount("");
    setDate("");
    setMessage("Goal created.");
    onSaved();
  }

  function close() {
    draft.current = null;
    setUncertain(false);
    setOpen(false);
    setMessage(null);
    if (uncertain) {
      setName("");
      setDescription("");
      setAmount("");
      setDate("");
      onSaved();
    }
  }

  if (!open) return (
    <View style={{ gap: space[2] }}>
      <Button label="Create a goal" onPress={() => { setOpen(true); setMessage(null); }} />
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
    </View>
  );

  return (
    <Card style={{ gap: space[2] }}>
      <TextField label="Goal name" value={name} onChangeText={setName} editable={editable} maxLength={80} />
      <TextField label="Description (optional)" value={description} onChangeText={setDescription} editable={editable} maxLength={500} />
      <Text variant="label">Goal type</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {TYPES.map((item) => <Button key={item} label={goalTypeLabel(item)} variant={item === type ? "primary" : "ghost"}
          accessibilityState={{ selected: item === type }} disabled={!editable} onPress={() => setType(item)} />)}
      </View>
      <Text variant="label">Currency</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {CURRENCIES.map((item) => <Button key={item} label={item} variant={item === currency ? "primary" : "ghost"}
          accessibilityState={{ selected: item === currency }} disabled={!editable} onPress={() => { setCurrency(item); setAmount(""); }} />)}
      </View>
      <TextField label={`Target amount (${currency})`} value={amount} onChangeText={setAmount} editable={editable}
        maxLength={19} keyboardType="decimal-pad" secureTextEntry={fullPrivacy} />
      <TextField label="Target date (optional, YYYY-MM-DD)" value={date} onChangeText={setDate} editable={editable} maxLength={10} />
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
      <Button label={uncertain ? "Retry creation" : "Save goal"} loading={busy} onPress={submit} />
      <Button label={uncertain ? "Review goals" : "Cancel"} variant="ghost" disabled={busy} onPress={close} />
    </Card>
  );
}

export function ArchiveGoalControl({ scope, goalId, onSaved }: { scope: GoalScope; goalId: string; onSaved(): void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const running = useRef(false);

  async function archive() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    const result = await archiveManagedGoal(scope, goalId);
    running.current = false;
    setBusy(false);
    if (result === "saved") {
      setConfirm(false);
      onSaved();
    } else {
      setMessage("Couldn’t confirm the archive. Check your access and connection, then try again.");
    }
  }

  if (!confirm) return <Button label="Archive goal" variant="ghost" onPress={() => setConfirm(true)} />;
  return (
    <View style={{ gap: space[2] }}>
      <Text>Archive this goal? Its contributions will stay in its history.</Text>
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
      <Button label="Confirm archive" loading={busy} onPress={archive} />
      <Button label="Cancel archive" variant="ghost" disabled={busy}
        onPress={() => { setConfirm(false); setMessage(null); }} />
    </View>
  );
}


export function RemoveContributionControl({ scope, goalId, entryId, dateLabel, onRefresh }: {
  scope: GoalScope;
  goalId: string;
  entryId: string;
  dateLabel: string;
  onRefresh(): void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const running = useRef(false);

  async function remove() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    const result = await removeGoalContribution(scope, goalId, entryId);
    running.current = false;
    setBusy(false);

    if (result === "saved") {
      setConfirm(false);
    } else {
      setMessage(result === "denied"
        ? "You don’t have permission to remove this contribution."
        : "Couldn’t confirm removal. Check the refreshed history before retrying.");
    }
    onRefresh();
  }

  if (!confirm) return <Button label="Remove contribution" accessibilityLabel={`Remove contribution from ${dateLabel}`}
    variant="ghost" size="sm" onPress={() => setConfirm(true)} />;
  return (
    <View style={{ gap: space[2] }}>
      <Text>Remove this entry from the goal’s progress? Any linked transaction stays in your ledger.</Text>
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
      <Button label="Confirm removal" loading={busy} onPress={remove} />
      <Button label="Cancel removal" variant="ghost" disabled={busy}
        onPress={() => { setConfirm(false); setMessage(null); }} />
    </View>
  );
}
