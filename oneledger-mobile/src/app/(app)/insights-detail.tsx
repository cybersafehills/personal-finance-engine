import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { PrivatePressable as Pressable } from "@/features/privacy/PrivatePressable";

import { fetchDrilldown } from "@/api/mobile-api";
import { Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import type { Drilldown, DrilldownKind } from "@/features/insights/types";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";

// The transactions behind one number on the Insights screen. The list is built
// by the server with the same rules as the total, so it always adds up to it.

const KINDS: readonly DrilldownKind[] = [
  "money_in", "money_out", "category", "counterparty_sent", "counterparty_received",
  "account", "transfers", "pending", "cash_out", "refunds",
];

export default function InsightsDetail() {
  const p = useLocalSearchParams<{
    kind: string; value: string; currency: string; from: string; to: string; accounts: string; title: string;
  }>();

  const accountsKey = p.accounts ?? "";
  const d: Drilldown | null = useMemo(() => {
    if (!KINDS.includes(p.kind as DrilldownKind) || !p.currency || !p.from || !p.to) return null;
    return {
      kind: p.kind as DrilldownKind,
      value: p.value ? p.value : null,
      currency: p.currency,
      from: p.from,
      to: p.to,
      accountIds: accountsKey ? accountsKey.split(",").filter(Boolean) : null,
    };
  }, [p.kind, p.value, p.currency, p.from, p.to, accountsKey]);

  const load = useCallback(() => (d ? fetchDrilldown(d) : Promise.resolve(null)), [d]);
  const { data, loading, refresh } = useQuery(load);

  return (
    <Screen>
      <ScreenHeader title={p.title || "Transactions"} />

      {!d ? (
        <EmptyState title="That list isn't available." />
      ) : loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : data && !data.ok ? (
        <EmptyState
          title={data.message}
          action={data.reason === "unavailable" ? undefined : <Button label="Try again" variant="secondary" onPress={refresh} />}
        />
      ) : data && data.ok ? (
        data.transactions.length === 0 ? (
          <EmptyState title="No transactions" />
        ) : (
          <>
            <Text variant="caption" color="textMuted">
              {data.total} {data.total === 1 ? "transaction" : "transactions"}
              {data.total > data.transactions.length ? ` - showing the latest ${data.transactions.length}` : ""}
            </Text>
            {data.transactions.map((t) => (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityLabel={`${t.counterpartyName ?? "Unknown"}, ${formatMoney(t.amountMinor, t.currency)}, ${formatDateTime(t.occurredAt)}. Open.`}
                onPress={() => router.push({ pathname: "/transaction/[id]", params: { id: t.id } })}
              >
                <Card style={{ gap: space[1] }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
                    <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
                      {t.counterpartyName ?? "Unknown"}
                    </Text>
                    <Text variant="bodyStrong" tabular>
                      {formatMoney(t.amountMinor, t.currency)}
                    </Text>
                  </View>
                  <Text variant="caption" color="textMuted">
                    {formatDateTime(t.occurredAt)}
                    {t.category ? ` · ${t.category}` : ""}
                    {t.status !== "settled" ? ` · ${t.status}` : ""}
                  </Text>
                </Card>
              </Pressable>
            ))}
          </>
        )
      ) : null}
    </Screen>
  );
}
