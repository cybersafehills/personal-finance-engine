import { useCallback, useState } from "react";
import { View } from "react-native";

import { fetchPeople } from "@/api/mobile-api";
import { Button, Card, Text } from "@/components/ds";
import { renamePerson } from "@/features/people/actions";
import type { PersonKind } from "@/features/people/types";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useQuery } from "@/hooks/useQuery";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";

import { SELF_EXPLANATION, topIncomeSources } from "./own-account";

/**
 * "Is this you?" for the biggest senders behind your usual income. One tap on
 * "This is me" removes that name from income, spending, budgets and the forecast
 * (Undo puts it back). Renders nothing where People is off or has nobody to ask
 * about. `onChanged` reloads the forecast so the new figures show straight away.
 */
export function OwnAccountPrompt({ onChanged }: { onChanged: () => void }) {
  const { amountsHidden } = usePrivacy();
  const load = useCallback(() => fetchPeople({ limit: 100 }), []);
  const { data, refresh } = useQuery(load);
  const [marked, setMarked] = useState<ReadonlyMap<string, PersonKind>>(new Map()); // id -> kind to restore
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data?.ok) return null;
  // Keep a just-marked row visible so it can be undone, even though the server now calls it "self".
  const sources = topIncomeSources(data.people);
  const shown = [...new Map([...sources.map((s) => [s.id, s] as const), ...data.people
    .filter((p) => marked.has(p.id))
    .map((p) => [p.id, { id: p.id, name: p.displayName, kind: p.kind, received: p.currencies.find((c) => c.currency === "RWF")?.receivedMinor ?? 0n, txnCount: p.txnCount }] as const)]).values()];
  if (shown.length === 0) return null;

  async function set(id: string, name: string, kind: PersonKind) {
    setBusy(id);
    setError(null);
    const result = await renamePerson(id, name, kind);
    setBusy(null);
    if (!result.ok) { setError(result.message); return; }
    setMarked((prev) => {
      const next = new Map(prev);
      if (kind === "self") next.set(id, shown.find((s) => s.id === id)?.kind ?? "person");
      else next.delete(id);
      return next;
    });
    refresh();
    onChanged();
  }

  return (
    <Card style={{ gap: space[2] }} accessibilityLabel="Where your usual income comes from">
      <Text variant="bodyStrong">Where your usual income comes from</Text>
      <Text variant="caption" color="textSecondary">
        The forecast counts money you receive as income. If one of these is really one of your own accounts, mark it and it stops counting. Amounts are all-time.
      </Text>
      <Text variant="caption" color="textMuted">{SELF_EXPLANATION}</Text>
      {error ? <Text color="attention" accessibilityLiveRegion="polite">{error}</Text> : null}
      {shown.map((s) => {
        const done = marked.has(s.id);
        return (
          <View key={s.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] }}>
            <View style={{ flexShrink: 1 }}>
              <Text variant="bodyStrong">{s.name}</Text>
              <Text variant="caption" color="textMuted">
                {`${s.txnCount} ${s.txnCount === 1 ? "transaction" : "transactions"}${amountsHidden ? "" : ` · received ${formatMoney(s.received, "RWF")}`}`}
              </Text>
            </View>
            {done ? (
              <Button label="Undo" variant="ghost" size="sm" disabled={busy === s.id} accessibilityLabel={`Undo: ${s.name} is not me`}
                onPress={() => void set(s.id, s.name, marked.get(s.id) ?? "person")} />
            ) : (
              <Button label="This is me" variant="secondary" size="sm" disabled={busy !== null} accessibilityLabel={`${s.name}: this is me`}
                onPress={() => void set(s.id, s.name, "self")} />
            )}
          </View>
        );
      })}
    </Card>
  );
}
