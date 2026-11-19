import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { fetchPeople } from "@/api/mobile-api";
import { Badge, Button, Card, Chip, EmptyState, ListGroup, ListRow, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { sortTransactions } from "@/features/people/actions";
import { KIND_LABEL, KIND_VARIANT, flowText, personSummary } from "@/features/people/display";
import type { PersonKind } from "@/features/people/types";
import { getTrustedRecipients } from "@/features/pay/recipients";
import { formatLocalMsisdn } from "@/features/pay/target";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

// People and merchants you have paid or been paid by, grouped from your
// transactions. Grouping is by phone number or merchant code where there is
// one; otherwise by name only, and we say so.

const FILTERS: { id: PersonKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "person", label: "People" },
  { id: "merchant", label: "Merchants" },
  { id: "unknown", label: "Not sure yet" },
];

export default function People() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<PersonKind | "all">("all");
  const [sorting, setSorting] = useState(false);
  const [sortError, setSortError] = useState<string | null>(null);

  // Search as you type, but only ask the server once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 350);
    return () => clearTimeout(t);
  }, [text]);

  const key = `${q}|${kind}`;
  const load = useCallback(
    async () => ({ key, result: await fetchPeople({ q, kind: kind === "all" ? undefined : kind }) }),
    [key, q, kind],
  );
  const { data, loading, refresh } = useQuery(load);

  // Contacts you saved from the Pay form. They are not in the list below until
  // your first payment to them is recorded, so they get their own section here.
  const loadSaved = useCallback(() => getTrustedRecipients().catch(() => []), []);
  const { data: savedAll } = useQuery(loadSaved);
  const needle = q.trim().toLowerCase();
  const saved = (savedAll ?? []).filter((r) => {
    if (kind === "unknown") return false;
    if (kind === "person" && r.kind !== "phone") return false;
    if (kind === "merchant" && r.kind !== "merchant") return false;
    if (!(r.kind === "phone" ? r.msisdn : r.merchantCode)) return false;
    return !needle || r.name.toLowerCase().includes(needle) || (r.msisdn ?? r.merchantCode ?? "").includes(needle);
  });
  const switching = data !== null && data.key !== key;
  const result = data && !switching ? data.result : null;

  async function sortNow(workspaceId: string) {
    setSorting(true);
    setSortError(null);
    const res = await sortTransactions(workspaceId);
    setSorting(false);
    if (!res.ok) setSortError(res.message);
    else refresh();
  }

  return (
    <Screen>
      <ScreenHeader title="People and merchants" subtitle="Who you pay and who pays you" />

      <TextField label="Search" value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} selected={kind === f.id} onPress={() => setKind(f.id)} />
        ))}
      </View>

      {saved.length > 0 ? (
        <ListGroup title="Saved contacts" footer="Saved from the Pay form. Tap one to pay again.">
          {saved.map((r) => (
            <ListRow
              key={r.id}
              icon={r.kind === "phone" ? "user" : "shopping-bag"}
              label={r.name}
              hint={r.msisdn ? formatLocalMsisdn(r.msisdn) : `Merchant code ${r.merchantCode}`}
              value={<Badge variant={r.kind === "phone" ? "accent" : "neutral"}>{r.kind === "phone" ? "Person" : "Merchant"}</Badge>}
              onPress={() =>
                router.push({ pathname: "/pay-new", params: { type: r.kind === "phone" ? "pay_person" : "pay_merchant", saved: r.id } })
              }
            />
          ))}
        </ListGroup>
      ) : null}

      {(loading && !data) || switching ? (
        <Text variant="label" color="textMuted" accessibilityLiveRegion="polite">
          Loading…
        </Text>
      ) : result && !result.ok ? (
        <EmptyState
          title={result.message}
          action={result.reason === "unavailable" ? undefined : <Button label="Try again" variant="secondary" onPress={refresh} />}
        />
      ) : result && result.ok ? (
        <>
          {result.unresolved > 0 ? (
            <Card style={{ gap: space[2] }}>
              <Text variant="label" color="textSecondary">
                {result.unresolved} {result.unresolved === 1 ? "transaction isn't" : "transactions aren't"} sorted into people yet.
              </Text>
              <Button label="Sort them now" variant="secondary" loading={sorting} onPress={() => sortNow(result.workspaceId)} />
              {sortError ? (
                <Text variant="caption" color="attention" accessibilityRole="alert">
                  {sortError}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {result.people.length === 0 ? (
            <EmptyState
              variant="setup"
              title={q || kind !== "all" ? "No matches" : "No people or merchants yet"}
              description={q || kind !== "all" ? "Try a different search or filter." : "They appear here once your transactions have been sorted."}
            />
          ) : (
            <>
              {result.people.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${personSummary(p)}. Open.`}
                  onPress={() => router.push({ pathname: "/person/[id]", params: { id: p.id } })}
                >
                  <Card style={{ gap: space[1] }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
                      <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
                        {p.displayName}
                      </Text>
                      <Badge variant={KIND_VARIANT[p.kind]}>{KIND_LABEL[p.kind]}</Badge>
                    </View>
                    {p.currencies.map((c) => (
                      <Text key={c.currency} variant="label" color="textSecondary">
                        {flowText(c)}
                      </Text>
                    ))}
                    <Text variant="caption" color="textMuted">
                      {p.txnCount} {p.txnCount === 1 ? "transaction" : "transactions"}
                      {p.confidence === "low" ? " · matched by name only" : ""}
                    </Text>
                  </Card>
                </Pressable>
              ))}
              {result.total > result.people.length ? (
                <Text variant="caption" color="textMuted">
                  Showing the first {result.people.length} of {result.total}. Search to find others.
                </Text>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
