import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { formatAmount } from "../../../../web/shared/financial";
import { Button, Text, TextField } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useQuery } from "@/hooks/useQuery";
import { kigaliDateKey } from "@/lib/kigali-time";
import { getNewId } from "@/offline/ids";
import { space } from "@/theme/tokens";
import {
  clearPendingContribution, contributionMinor, loadGoalContributions, restorePendingContribution,
  saveGoalContribution, storePendingContribution, type ContributionRequest,
} from "./contributions";
import { RemoveContributionControl } from "./GoalManagement";
import { dayLabel } from "./display";
import type { Goal } from "./types";

function today() {
  return kigaliDateKey(new Date().toISOString());
}

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today() || date < "0001-01-01") return false;
  const value = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().startsWith(date);
}

export function GoalContributions({ goal, workspaceId, userId, canContribute, canManage = false, onSaved }: {
  goal: Goal;
  workspaceId: string;
  userId: string;
  canContribute: boolean;
  canManage?: boolean;
  onSaved(): void;
}) {
  const { fullPrivacy } = usePrivacy();
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState<"idle" | "saving" | "retry">("idle");
  const [storage, setStorage] = useState<"loading" | "available" | "unavailable">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<ContributionRequest | null>(null);
  const [pendingAmount, setPendingAmount] = useState<bigint | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(() => historyOpen ? loadGoalContributions(workspaceId, goal.id) : Promise.resolve([]), [goal.id, historyOpen, workspaceId]);
  const history = useQuery(load, historyOpen ? "history" : "closed");

  useEffect(() => {
    let current = true;
    const scope = { userId, workspaceId, goalId: goal.id };
    void restorePendingContribution(scope, goal.currency).then((draft) => {
      if (!current) return;
      pending.current = draft;
      if (draft) {
        setEditing(true);
        setStatus("retry");
        setDate(draft.date);
        setPendingAmount(draft.amount);
        setMessage("A contribution is awaiting confirmation.");
      }
      setStorage("available");
    }).catch(() => { if (current) setStorage("unavailable"); });
    return () => { current = false; };
  }, [goal.currency, goal.id, userId, workspaceId]);

  async function save() {
    if (inFlight.current) return;
    let request = pending.current;
    if (!request) {
      const minor = contributionMinor(amount, goal.currency);
      if (minor === null) {
        setMessage(`Enter a positive amount in ${goal.currency} using the correct decimal places.`);
        return;
      }
      if (!validDate(date)) {
        setMessage("Enter a valid date on or before today (YYYY-MM-DD).");
        return;
      }
      request = { id: getNewId(), userId, workspaceId, goalId: goal.id, currency: goal.currency, amount: minor, date };
    }

    inFlight.current = true;
    setStatus("saving");
    setMessage(null);
    if (!pending.current) {
      try {
        await storePendingContribution(request);
        pending.current = request;
        setPendingAmount(request.amount);
      } catch {
        inFlight.current = false;
        setStatus("idle");
        setMessage("Couldn’t prepare a safe retry on this device. Try again before recording the contribution.");
        return;
      }
    }
    const result = await saveGoalContribution(request);
    if (result === "retry") {
      inFlight.current = false;
      setStatus("retry");
      setMessage("Couldn’t confirm the save. Retry this request or check contribution history before entering it again.");
      return;
    }

    try {
      await clearPendingContribution(request);
    } catch {
      inFlight.current = false;
      setStatus("retry");
      setMessage(result === "saved" ? "Contribution recorded. Retry to clear the pending request from this device." : "Couldn’t clear the pending request. Try again.");
      if (result === "saved") onSaved();
      return;
    }
    inFlight.current = false;
    pending.current = null;
    setPendingAmount(null);
    setStatus("idle");
    if (result === "denied") {
      setMessage("Couldn’t record this contribution. Check your access and the goal’s status.");
      return;
    }

    setEditing(false);
    setAmount("");
    setMessage("Contribution recorded.");
    onSaved();
    if (historyOpen) history.refresh();
  }

  return (
    <View style={{ gap: space[2] }}>
      {storage === "unavailable" && canContribute ? <Text>Couldn’t check for a pending contribution. Reopen Goals to retry.</Text> : null}
      {storage === "available" && (canContribute || status !== "idle") && editing ? (
        <>
          <Text>Record money you already set aside. This does not move money.</Text>
          {status === "retry" && pendingAmount !== null ? (
            <>
              <Text>{fullPrivacy ? "Amount hidden" : formatAmount(pendingAmount, goal.currency, false)}</Text>
              <Text>{dayLabel(date)}</Text>
            </>
          ) : (
            <>
              <TextField label={`Amount (${goal.currency})`} value={amount} onChangeText={setAmount}
                keyboardType="decimal-pad" editable={status === "idle"} secureTextEntry={fullPrivacy} />
              <TextField label="Contribution date (YYYY-MM-DD)" value={date} onChangeText={setDate}
                keyboardType="numbers-and-punctuation" editable={status === "idle"} maxLength={10} />
            </>
          )}
          <Button label={status === "retry" ? "Retry save" : "Record contribution"} loading={status === "saving"} onPress={save} />
          {status === "idle" ? <Button label="Cancel" variant="ghost" onPress={() => { setEditing(false); setMessage(null); setAmount(""); }} /> : null}
        </>
      ) : canContribute && storage === "available" ? (
        <Button label="Add contribution" variant="secondary" onPress={() => { setEditing(true); setDate(today()); setMessage(null); }} />
      ) : null}
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
      <Button label={historyOpen ? "Hide contributions" : "Contribution history"} variant="ghost" onPress={() => setHistoryOpen(!historyOpen)} />
      {historyOpen && history.error ? (
        <>
          <Text>Couldn’t load contributions.</Text>
          <Button label="Retry history" variant="secondary" onPress={history.refresh} />
        </>
      ) : null}
      {historyOpen && !history.data && !history.error ? <Text>Loading contributions…</Text> : null}
      {historyOpen && history.data ? (
        <>
          <Text variant="label">{history.data.length ? "Latest contributions" : "No contributions recorded yet."}</Text>
          {history.data.map((entry) => {
            let amountLabel = "Amount unavailable";
            try { amountLabel = formatAmount(entry.amount_minor, goal.currency, false); } catch { /* Unsafe amounts stay unavailable. */ }
            return (
              <View key={entry.id}>
                <Text>{fullPrivacy ? "Amount hidden" : amountLabel}</Text>
                <Text variant="caption">{dayLabel(entry.contribution_date)} · {entry.source === "manual" ? "Recorded manually" : "Linked transaction"}</Text>
                {goal.status !== "archived" && (canManage || entry.created_by === userId) ? (
                  <RemoveContributionControl scope={{ workspaceId, userId }} goalId={goal.id}
                    entryId={entry.id} dateLabel={dayLabel(entry.contribution_date)}
                    onRefresh={() => { history.refresh(); onSaved(); }} />
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}
