import { useRef, useState } from "react";
import { View } from "react-native";

import { formatAmount } from "../../../../shared/financial";
import { Button, Text, TextField } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { space } from "@/theme/tokens";
import { ALLOCATION_TYPES, allocationPercentages, editAllocationPlan, type AllocationFields, type AllocationSnapshot } from "./allocation-editor";

const LABELS = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

export function AllocationEditor({ userId, workspaceId, budgetId, onSaved }: {
  userId: string;
  workspaceId: string;
  budgetId: string;
  onSaved(): void;
}) {
  const { fullPrivacy } = usePrivacy();
  const [snapshot, setSnapshot] = useState<AllocationSnapshot | null>(null);
  const [fields, setFields] = useState<AllocationFields | null>(null);
  const [preview, setPreview] = useState<AllocationSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [mustReload, setMustReload] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const running = useRef(false);
  const scope = { userId, workspaceId, budgetId };
  const percentages = fields && allocationPercentages(fields);

  async function load() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    const result = await editAllocationPlan(scope);
    running.current = false;
    setBusy(false);

    if (result.kind !== "snapshot") {
      setMessage("Couldn’t load allocations. Check your access and connection, then try again.");
      return;
    }
    setSnapshot(result.value);
    setFields(Object.fromEntries(result.value.allocations.map((a) => [a.type, String(a.percentage)])) as AllocationFields);
    setPreview(null);
    setMustReload(false);
  }

  async function submit(save: boolean) {
    if (!snapshot || !percentages || running.current || mustReload || (save && !preview)) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    const result = await editAllocationPlan(scope, { revision: snapshot.revision, percentages, save });
    running.current = false;
    setBusy(false);

    if (result.kind === "snapshot" && !save) {
      setPreview(result.value);
      return;
    }
    if (result.kind === "saved" && save) {
      setSnapshot(null);
      setFields(null);
      setPreview(null);
      setMessage("Allocations saved.");
      onSaved();
      return;
    }
    setPreview(null);
    if (result.kind === "stale" || result.kind === "denied" || save) {
      setMustReload(true);
      setMessage(result.kind === "stale"
        ? "This budget changed since you opened it. Load the latest allocations before saving."
        : result.kind === "denied"
          ? "You no longer have access to edit this budget."
          : "Couldn’t confirm the save. Load the latest allocations to see what was recorded.");
    } else {
      setMessage("Couldn’t preview these allocations. Check your connection and try again.");
    }
  }

  return (
    <View style={{ gap: space[2] }}>
      {!fields ? <Button label="Edit allocations" variant="secondary" loading={busy} onPress={load} /> : (
        <>
          {ALLOCATION_TYPES.map((type) => (
            <TextField key={type} label={`${LABELS[type]} (%)`} value={fields[type]} keyboardType="decimal-pad"
              editable={!busy && !mustReload} maxLength={6}
              onChangeText={(value) => { setFields({ ...fields, [type]: value }); setPreview(null); setMessage(null); }} />
          ))}
          {!percentages ? <Text variant="caption">Use up to two decimal places and make the total 100%.</Text> : null}
          {preview ? (
            <View style={{ gap: space[1] }}>
              <Text variant="bodyStrong">New monthly targets</Text>
              {preview.allocations.map((a) => (
                <Text key={a.type}>{LABELS[a.type]} · {fullPrivacy ? "Amount hidden" : formatAmount(a.target_minor, preview.currency, false)}</Text>
              ))}
            </View>
          ) : null}
          {mustReload
            ? <Button label="Load latest allocations" variant="secondary" loading={busy} onPress={load} />
            : preview
              ? <Button label="Save allocations" loading={busy} onPress={() => submit(true)} />
              : <Button label="Preview targets" disabled={!percentages} loading={busy} onPress={() => submit(false)} />}
          <Button label="Cancel" variant="ghost" disabled={busy} onPress={() => { setFields(null); setSnapshot(null); setPreview(null); setMustReload(false); setMessage(null); }} />
        </>
      )}
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
    </View>
  );
}
