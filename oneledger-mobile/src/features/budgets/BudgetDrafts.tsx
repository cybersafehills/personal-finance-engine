import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { formatAmount, type Currency } from "../../../../web/shared/financial";
import { Button, Card, Chip, Text, TextField } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useQuery } from "@/hooks/useQuery";
import { getNewId } from "@/offline/ids";
import { space } from "@/theme/tokens";
import { ALLOCATION_TYPES, allocationPercentages, editAllocationPlan, type AllocationFields, type AllocationSnapshot } from "./allocation-editor";
import { AllocationEditor } from "./AllocationEditor";
import {
  activateDraftBudget, clearPendingBudget, createDraftBudget, FREQUENCIES, loadDraftBudgets,
  parseBudgetInput, readPendingBudget, storePendingBudget, type BudgetInput, type DraftRow, type PendingDraft,
} from "./budget-lifecycle";
import type { BudgetScope } from "./budget-session";
import { periodLabel } from "./display";

const LABELS = { ESSENTIALS: "Essentials", INVESTING: "Investing", EMERGENCY: "Emergency savings", WANTS: "Wants" };
const DEFAULT_INPUT: BudgetInput = {
  name: "", currency: "RWF", start: "", end: "", income: "", frequency: "monthly",
  allocation: { ESSENTIALS: "50", INVESTING: "15", EMERGENCY: "5", WANTS: "30" },
};

export function BudgetDrafts({ scope, onActivated }: { scope: BudgetScope; onActivated(): void }) {
  const { userId, workspaceId } = scope;
  const load = useCallback(() => loadDraftBudgets({ userId, workspaceId }), [userId, workspaceId]);
  const drafts = useQuery(load, "budget-drafts");

  function refresh() {
    drafts.refresh();
    onActivated();
  }

  return (
    <View style={{ gap: space[2] }}>
      <DraftComposer scope={scope} onSaved={drafts.refresh} />
      {drafts.error ? (
        <View style={{ gap: space[1] }}>
          <Text>Couldn’t load budget drafts.</Text>
          <Button label="Retry drafts" variant="ghost" onPress={drafts.refresh} />
        </View>
      ) : null}
      {drafts.data?.length ? <Text variant="heading">Budget drafts</Text> : null}
      {drafts.data?.map((draft) => (
        <Card key={draft.id} style={{ gap: space[2] }}>
          <Text variant="bodyStrong">{draft.name}</Text>
          <Text variant="caption">{draft.currency} · {periodLabel(draft.period_start, draft.period_end)}</Text>
          <AllocationEditor {...scope} budgetId={draft.id} onSaved={drafts.refresh} />
          <ActivateDraft scope={scope} draft={draft} onRefresh={refresh} />
        </Card>
      ))}
    </View>
  );
}

function DraftComposer({ scope, onSaved }: { scope: BudgetScope; onSaved(): void }) {
  const { fullPrivacy } = usePrivacy();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [pending, setPending] = useState<PendingDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const running = useRef(false);
  const editable = !pending && !busy;

  function update<K extends keyof BudgetInput>(key: K, value: BudgetInput[K]) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  async function openForm() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    try {
      setPending(await readPendingBudget(scope));
      setOpen(true);
    } catch {
      setMessage("Couldn’t check for an unfinished budget save. Try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function save() {
    if (running.current) return;
    let draft = pending;
    if (!draft) {
      const parsed = parseBudgetInput(input);
      if ("error" in parsed) {
        setMessage(parsed.error);
        return;
      }
      draft = { ...parsed.draft, id: getNewId() };
    }
    running.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (!pending) {
        try {
          await storePendingBudget(scope, draft);
        } catch {
          setMessage("Couldn’t prepare a safe retry on this device. Try saving again.");
          return;
        }
        setPending(draft);
      }

      const result = await createDraftBudget(scope, draft);
      if (result === "unconfirmed") {
        setMessage("Couldn’t confirm the save. Retry the same request to check whether the draft was created.");
        return;
      }
      if (result === "saved") onSaved();
      try {
        await clearPendingBudget(scope);
      } catch {
        setMessage(result === "saved" ? "Draft saved. Retry to clear the pending request." : "Couldn’t clear the pending request.");
        return;
      }
      setPending(null);
      if (result === "denied") {
        setMessage("Couldn’t save the draft. Check the values and your access to this Space.");
        return;
      }
      setOpen(false);
      setInput(DEFAULT_INPUT);
      setMessage("Budget draft saved.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  if (!open) return (
    <View style={{ gap: space[1] }}>
      <Button label="Create budget" onPress={openForm} loading={busy} />
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
    </View>
  );

  return (
    <Card style={{ gap: space[2] }}>
      {pending ? (
        <Text>A budget save is awaiting confirmation. Retrying uses the original budget details.</Text>
      ) : (
        <>
          <TextField label="Budget name" value={input.name} maxLength={80} editable={editable} onChangeText={(value) => update("name", value)} />
          <TextField label="Start date (YYYY-MM-DD)" value={input.start} maxLength={10} editable={editable} onChangeText={(value) => update("start", value)} />
          <TextField label="End date (YYYY-MM-DD)" value={input.end} maxLength={10} editable={editable} onChangeText={(value) => update("end", value)} />
          <Text variant="label">Currency</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
            {(["RWF", "USD", "EUR"] as Currency[]).map((currency) => (
              <Chip key={currency} label={currency} selected={input.currency === currency}
                onPress={() => { if (editable) setInput((current) => ({ ...current, currency, income: "" })); }} />
            ))}
          </View>
          <TextField label={`Income (${input.currency})`} value={input.income} keyboardType="decimal-pad"
            editable={editable} maxLength={19} secureTextEntry={fullPrivacy} onChangeText={(value) => update("income", value)} />
          <Text variant="label">Income frequency</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
            {(Object.keys(FREQUENCIES) as BudgetInput["frequency"][]).map((frequency) => (
              <Chip key={frequency} label={FREQUENCIES[frequency]} selected={input.frequency === frequency}
                onPress={() => { if (editable) update("frequency", frequency); }} />
            ))}
          </View>
          <Text variant="label">Allocation percentages</Text>
          {ALLOCATION_TYPES.map((type) => (
            <TextField key={type} label={`${LABELS[type]} (%)`} value={input.allocation[type]}
              keyboardType="decimal-pad" maxLength={6} editable={editable}
              onChangeText={(value) => setInput((current) => ({ ...current, allocation: { ...current.allocation, [type]: value } }))} />
          ))}
        </>
      )}
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
      <Button label={pending ? "Retry draft save" : "Save as draft"} loading={busy} onPress={save} />
      <Button label={pending ? "Close draft form" : "Cancel draft"} variant="ghost" disabled={busy}
        onPress={() => { setOpen(false); setMessage(null); }} />
    </Card>
  );
}

function ActivateDraft({ scope, draft, onRefresh }: { scope: BudgetScope; draft: DraftRow; onRefresh(): void }) {
  const { amountsHidden } = usePrivacy();
  const [plan, setPlan] = useState<AllocationSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  async function review() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    const result = await editAllocationPlan({ ...scope, budgetId: draft.id });
    running.current = false;
    setBusy(false);
    if (result.kind !== "snapshot") {
      setMessage("Couldn’t load the latest draft. Try again.");
      return;
    }
    const fields = Object.fromEntries(result.value.allocations.map((allocation) => [
      allocation.type, String(allocation.percentage),
    ])) as AllocationFields;
    if (!allocationPercentages(fields)) {
      setMessage("Edit the allocations so they total 100% before activating.");
      return;
    }
    setPlan(result.value);
  }

  async function activate() {
    if (!plan || running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    const result = await activateDraftBudget(scope, draft.id, plan.revision);
    running.current = false;
    setBusy(false);
    setPlan(null);
    if (result === "saved") {
      onRefresh();
    } else if (result === "stale") {
      setMessage("The draft changed. Review its latest allocations before activating.");
    } else if (result === "conflict") {
      setMessage("This Space already has an active budget in this currency. Complete or archive it first.");
    } else if (result === "denied") {
      setMessage("Couldn’t activate this draft. Check your access and its allocations.");
    } else {
      setMessage("Couldn’t confirm activation. Check the refreshed budgets.");
      onRefresh();
    }
  }

  return (
    <View style={{ gap: space[1] }}>
      {plan ? (
        <>
          <Text variant="label">Activate this budget with these monthly targets?</Text>
          {plan.allocations.map((allocation) => (
            <Text key={allocation.type} variant="caption">
              {`${LABELS[allocation.type]} · ${allocation.percentage}% · ${amountsHidden ? "Amount hidden" : formatAmount(allocation.target_minor, plan.currency, false)}`}
            </Text>
          ))}
          <Button label="Confirm activation" loading={busy} onPress={activate} />
          <Button label="Cancel activation" variant="ghost" disabled={busy} onPress={() => setPlan(null)} />
        </>
      ) : <Button label="Review and activate" variant="secondary" loading={busy} onPress={review} />}
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
    </View>
  );
}
