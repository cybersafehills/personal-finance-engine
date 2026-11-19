import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { PrivatePressable as Pressable } from "@/features/privacy/PrivatePressable";

import { fetchPeople, fetchPerson } from "@/api/mobile-api";
import { Badge, Button, Card, Chip, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { formatDateTime } from "@/lib/kigali-time";
import { formatMoney } from "@/lib/money";
import {
  combinePeople,
  renamePerson,
  separateTransactions,
  undoCombine,
  undoSeparate,
  type ActionResult,
} from "@/features/people/actions";
import { KIND_LABEL, KIND_VARIANT, confidenceLabel, confidenceNote, flowText } from "@/features/people/display";
import type { Person, PersonDetail, PersonKind } from "@/features/people/types";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

// One person or merchant. You can rename them, combine them with another, or
// separate some transactions into a new person - and every combine/separate can
// be undone. Nothing here changes a transaction itself.

type Undo = { label: string; run: () => Promise<ActionResult> } | null;

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => fetchPerson(id), [id]);
  const { data, loading, refresh } = useQuery(load);
  const [undo, setUndo] = useState<Undo>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Combined into another: go to the one it became.
  useEffect(() => {
    if (data && !data.ok && "survivorId" in data) {
      router.replace({ pathname: "/person/[id]", params: { id: data.survivorId } });
    }
  }, [data]);

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : data && !data.ok ? (
        "survivorId" in data ? (
          <Text variant="label" color="textMuted">
            Opening…
          </Text>
        ) : (
          <EmptyState
            title={data.message}
            action={data.reason === "unavailable" ? undefined : <Button label="Try again" variant="secondary" onPress={refresh} />}
          />
        )
      ) : data && data.ok ? (
        <Detail
          detail={data.detail}
          undo={undo}
          notice={notice}
          onChanged={(msg, u) => {
            setNotice(msg);
            setUndo(u);
            refresh();
          }}
          onUndone={() => {
            setNotice("Undone.");
            setUndo(null);
            refresh();
          }}
        />
      ) : null}
    </Screen>
  );
}

function Detail({
  detail,
  undo,
  notice,
  onChanged,
  onUndone,
}: {
  detail: PersonDetail;
  undo: Undo;
  notice: string | null;
  onChanged: (msg: string, undo: Undo) => void;
  onUndone: () => void;
}) {
  const p = detail.person;
  const [mode, setMode] = useState<null | "rename" | "combine" | "separate">(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const note = confidenceNote(p.confidence);

  async function doUndo() {
    if (!undo) return;
    setUndoBusy(true);
    setUndoError(null);
    const res = await undo.run();
    setUndoBusy(false);
    if (res.ok) onUndone();
    else setUndoError(res.message);
  }

  return (
    <>
      <ScreenHeader title={p.displayName} subtitle={confidenceLabel(p.confidence)} />
      <View style={{ flexDirection: "row", gap: space[2] }}>
        <Badge variant={KIND_VARIANT[p.kind]}>{KIND_LABEL[p.kind]}</Badge>
      </View>

      {notice ? (
        <Card style={{ gap: space[2] }}>
          <Text variant="label" accessibilityLiveRegion="polite">
            {notice}
          </Text>
          {undo ? <Button label={undo.label} variant="secondary" loading={undoBusy} onPress={doUndo} /> : null}
          {undoError ? (
            <Text variant="caption" color="attention" accessibilityRole="alert">
              {undoError}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {note ? (
        <Text variant="caption" color="textMuted">
          {note}
        </Text>
      ) : null}

      <Card style={{ gap: space[2] }}>
        {p.currencies.length === 0 ? (
          <Text variant="label" color="textMuted">
            No settled transactions yet.
          </Text>
        ) : (
          p.currencies.map((c) => (
            <View key={c.currency} style={{ gap: 2 }}>
              <Text variant="bodyStrong">{flowText(c)}</Text>
              <Text variant="caption" color="textMuted">
                Net {formatMoney(c.netMinor, c.currency)} over {c.txnCount} {c.txnCount === 1 ? "transaction" : "transactions"}
              </Text>
            </View>
          ))
        )}
        {p.firstAt && p.lastAt ? (
          <Text variant="caption" color="textMuted">
            First {formatDateTime(p.firstAt)} · Latest {formatDateTime(p.lastAt)}
          </Text>
        ) : null}
      </Card>

      {detail.mergedFrom.length > 0 ? (
        <Card style={{ gap: space[1] }}>
          <Text variant="label" color="textSecondary">
            Combined from
          </Text>
          {detail.mergedFrom.map((m) => (
            <Text key={m.id} variant="caption" color="textMuted">
              {m.displayName}
            </Text>
          ))}
        </Card>
      ) : null}

      {mode === null ? (
        <View style={{ gap: space[2] }}>
          <Button label="Rename or change type" variant="secondary" onPress={() => setMode("rename")} fullWidth />
          <Button label="Combine with another" variant="secondary" onPress={() => setMode("combine")} fullWidth />
          {detail.transactions.length > 1 ? (
            <Button label="Separate some transactions" variant="secondary" onPress={() => setMode("separate")} fullWidth />
          ) : null}
        </View>
      ) : mode === "rename" ? (
        <RenameForm
          person={p}
          onCancel={() => setMode(null)}
          onDone={() => {
            setMode(null);
            onChanged("Saved.", null);
          }}
        />
      ) : mode === "combine" ? (
        <CombinePicker
          person={p}
          onCancel={() => setMode(null)}
          onDone={(eventId, otherName) => {
            setMode(null);
            onChanged(`Combined with ${otherName}.`, { label: "Undo", run: () => undoCombine(eventId) });
          }}
        />
      ) : (
        <SeparatePicker
          person={p}
          detail={detail}
          onCancel={() => setMode(null)}
          onDone={(eventId, name) => {
            setMode(null);
            onChanged(`Moved the chosen transactions to "${name}".`, { label: "Undo", run: () => undoSeparate(eventId) });
          }}
        />
      )}

      <Text variant="bodyStrong">Transactions</Text>
      {detail.transactions.length === 0 ? (
        <EmptyState title="No transactions" />
      ) : (
        <>
          {detail.totalTransactions > detail.transactions.length ? (
            <Text variant="caption" color="textMuted">
              Showing the latest {detail.transactions.length} of {detail.totalTransactions}.
            </Text>
          ) : null}
          {detail.transactions.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`${formatMoney(t.amountMinor, t.currency)}, ${formatDateTime(t.occurredAt)}. Open.`}
              onPress={() => router.push({ pathname: "/transaction/[id]", params: { id: t.id } })}
            >
              <Card style={{ gap: space[1] }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
                  <Text variant="label" style={{ flexShrink: 1 }}>
                    {formatDateTime(t.occurredAt)}
                  </Text>
                  <Text variant="bodyStrong" tabular>
                    {formatMoney(t.amountMinor, t.currency)}
                  </Text>
                </View>
                {t.category ? (
                  <Text variant="caption" color="textMuted">
                    {t.category}
                  </Text>
                ) : null}
              </Card>
            </Pressable>
          ))}
        </>
      )}
    </>
  );
}

const KINDS: PersonKind[] = ["person", "merchant", "unknown", "self"];

function RenameForm({ person, onCancel, onDone }: { person: Person; onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState(person.displayName);
  const [kind, setKind] = useState<PersonKind>(person.kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await renamePerson(person.id, name, kind);
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.message);
  }
  return (
    <Card style={{ gap: space[3] }}>
      <TextField label="Name" value={name} onChangeText={setName} maxLength={120} error={error ?? undefined} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {KINDS.map((k) => (
          <Chip key={k} label={KIND_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />
        ))}
      </View>
      <Text variant="caption" color="textMuted">
        The original names on your transactions do not change.
      </Text>
      <Button label="Save" loading={busy} onPress={save} fullWidth />
      <Button label="Cancel" variant="ghost" onPress={onCancel} />
    </Card>
  );
}

function CombinePicker({
  person,
  onCancel,
  onDone,
}: {
  person: Person;
  onCancel: () => void;
  onDone: (eventId: string, otherName: string) => void;
}) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 350);
    return () => clearTimeout(t);
  }, [text]);
  const load = useCallback(() => fetchPeople({ q, limit: 20 }), [q]);
  const { data } = useQuery(load);
  const others = data && data.ok ? data.people.filter((o) => o.id !== person.id) : [];

  async function choose(other: Person) {
    setBusyId(other.id);
    setError(null);
    // The one you are looking at is kept; the chosen one is folded into it.
    const res = await combinePeople(person.id, [other.id]);
    setBusyId(null);
    if (res.ok) onDone(res.value, other.displayName);
    else setError(res.message);
  }

  return (
    <Card style={{ gap: space[3] }}>
      <Text variant="bodyStrong">Combine with another</Text>
      <Text variant="caption" color="textMuted">
        Choose someone who is the same as {person.displayName}. Their transactions will show here. You can undo this.
      </Text>
      <TextField label="Search" value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} />
      {others.map((o) => (
        <Button
          key={o.id}
          label={`${o.displayName} (${o.txnCount})`}
          variant="secondary"
          loading={busyId === o.id}
          disabled={busyId !== null}
          onPress={() => choose(o)}
          fullWidth
        />
      ))}
      {data && data.ok && others.length === 0 ? (
        <Text variant="caption" color="textMuted">
          No one else found.
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" color="attention" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label="Cancel" variant="ghost" onPress={onCancel} />
    </Card>
  );
}

function SeparatePicker({
  person,
  detail,
  onCancel,
  onDone,
}: {
  person: Person;
  detail: PersonDetail;
  onCancel: () => void;
  onDone: (eventId: string, name: string) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save() {
    if (chosen.size === 0) {
      setError("Choose at least one transaction.");
      return;
    }
    if (!name.trim()) {
      setError("Give the new person a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await separateTransactions(person.id, [...chosen], name);
    setBusy(false);
    if (res.ok) onDone(res.value, name.trim());
    else setError(res.message);
  }

  return (
    <Card style={{ gap: space[3] }}>
      <Text variant="bodyStrong">Separate some transactions</Text>
      <Text variant="caption" color="textMuted">
        Use this when two different people share one name. Tick the transactions that belong to someone else. You can undo this.
      </Text>
      {detail.transactions.map((t) => {
        const on = chosen.has(t.id);
        return (
          <Pressable
            key={t.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${formatMoney(t.amountMinor, t.currency)}, ${formatDateTime(t.occurredAt)}`}
            onPress={() => toggle(t.id)}
            style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3], minHeight: 44, alignItems: "center" }}
          >
            <Text variant="label" style={{ flexShrink: 1 }}>
              {on ? "☑" : "☐"} {formatDateTime(t.occurredAt)}
            </Text>
            <Text variant="label" tabular>
              {formatMoney(t.amountMinor, t.currency)}
            </Text>
          </Pressable>
        );
      })}
      <TextField label="Name for the other person" value={name} onChangeText={setName} maxLength={120} />
      {error ? (
        <Text variant="caption" color="attention" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label={`Move ${chosen.size || ""} ${chosen.size === 1 ? "transaction" : "transactions"}`.replace("  ", " ")} loading={busy} onPress={save} fullWidth />
      <Button label="Cancel" variant="ghost" onPress={onCancel} />
    </Card>
  );
}
