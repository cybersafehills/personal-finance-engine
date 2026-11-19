import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { PrivatePressable as Pressable } from "@/features/privacy/PrivatePressable";

import { fetchInsights, fetchMoreFlags, fetchWallets } from "@/api/mobile-api";
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ProgressBar,
  Screen,
  ScreenHeader,
  StatTile,
  Text,
} from "@/components/ds";
import {
  bpsFraction,
  categorySummary,
  compareText,
  formatBps,
  netTone,
} from "@/features/insights/display";
import { ForecastPanel } from "@/features/insights/ForecastPanel";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { insightPeriods, type PeriodId } from "@/features/insights/period";
import { personIdFromKey } from "@/features/people/display";
import type { CurrencyOverview, Drilldown } from "@/features/insights/types";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";

// Where your money went: money in / out / net for a period, by category and by
// person, per currency (never mixed). Every number opens the transactions
// behind it. The figures come from the web's shared calculation (the app only
// displays them); confirmed transfers between your own wallets are excluded.

function openDrilldown(d: Drilldown, title: string) {
  router.push({
    pathname: "/insights-detail",
    params: {
      kind: d.kind,
      value: d.value ?? "",
      currency: d.currency,
      from: d.from,
      to: d.to,
      accounts: (d.accountIds ?? []).join(","),
      title,
    },
  });
}

export default function Insights() {
  const { activeId } = useActiveSpace();
  return <InsightsForSpace key={activeId ?? "none"} workspaceId={activeId} />;
}

function InsightsForSpace({ workspaceId }: { workspaceId: string | null }) {
  const periods = useMemo(() => insightPeriods(new Date()), []);
  const [periodId, setPeriodId] = useState<PeriodId>("this_month");
  const [walletId, setWalletId] = useState<string | null>(null);
  const period = periods.find((p) => p.id === periodId) ?? periods[0];

  const loadWallets = useCallback(() => fetchWallets(workspaceId ?? undefined), [workspaceId]);
  const loadFlags = useCallback(() => workspaceId ? fetchMoreFlags() : Promise.resolve(null), [workspaceId]);
  const { data: flags } = useQuery(loadFlags);
  const { data: wallets } = useQuery(loadWallets);
  const walletList = wallets && wallets.ok ? wallets.wallets : [];

  const key = `${period.from}|${period.to}|${walletId ?? "all"}`;
  const load = useCallback(
    async () => ({
      key,
      result: await fetchInsights({
        from: period.from,
        to: period.to,
        accountIds: walletId ? [walletId] : undefined,
        compare: true,
      }),
    }),
    [key, period.from, period.to, walletId],
  );
  const { data, loading, refresh } = useQuery(load);
  // The previous answer stays on screen while a new one loads, so say so.
  const switching = data !== null && data.key !== key;
  const result = data && !switching ? data.result : null;

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <ScreenHeader title="Insights" subtitle="Where your money went" />

      <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {periods.map((p) => (
          <Chip key={p.id} label={p.label} selected={p.id === periodId} onPress={() => setPeriodId(p.id)} />
        ))}
      </View>

      {walletList.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          <Chip label="All wallets" selected={walletId === null} onPress={() => setWalletId(null)} />
          {walletList.map((w) => (
            <Chip key={w.id} label={w.name} selected={walletId === w.id} onPress={() => setWalletId(w.id)} />
          ))}
        </View>
      ) : null}

      {workspaceId && flags?.insights && flags.insightsCenter ? <ForecastPanel workspaceId={workspaceId} accountId={walletId} /> : null}

      {(loading && !data) || switching ? (
        <Text variant="label" color="textMuted" accessibilityLiveRegion="polite">
          Loading…
        </Text>
      ) : result && !result.ok ? (
        <EmptyState
          title={result.message}
          action={
            result.reason === "unavailable" ? undefined : (
              <Button label="Try again" variant="secondary" onPress={refresh} />
            )
          }
        />
      ) : result && result.ok ? (
        result.overview.currencies.length === 0 ? (
          <EmptyState
            variant="setup"
            title="Nothing recorded in this period"
            description="Transactions appear here once they have been recorded and settled."
          />
        ) : (
          <>
            {result.overview.currencies.map((c) => (
              <CurrencySection key={c.currency} c={c} multi={result.overview.currencies.length > 1} />
            ))}
            {result.overview.skippedCurrencies > 0 ? (
              <Text variant="caption" color="textMuted">
                Some activity in a currency this app cannot show yet is not included.
              </Text>
            ) : null}
            {result.overview.latestTxnAt ? (
              <Text variant="caption" color="textMuted">
                Based on transactions up to {formatDateTime(result.overview.latestTxnAt)}.
              </Text>
            ) : null}
          </>
        )
      ) : null}
    </Screen>
  );
}

function CurrencySection({ c, multi }: { c: CurrencyOverview; multi: boolean }) {
  const m = (v: bigint) => formatMoney(v, c.currency);
  const net = netTone(c.netMinor);
  return (
    <View style={{ gap: space[3] }}>
      {multi ? <Text variant="heading">{c.currency}</Text> : null}

      <View style={{ flexDirection: "row", gap: space[3] }}>
        <Pressable
          style={{ flex: 1 }}
          accessibilityRole="button"
          accessibilityLabel={`Money in ${m(c.moneyInMinor)}. See the transactions.`}
          onPress={() => openDrilldown(c.drilldowns.moneyIn, "Money in")}
        >
          <StatTile label="Money in" value={m(c.moneyInMinor)} hint={`${c.countIn} ${c.countIn === 1 ? "transaction" : "transactions"}`} />
        </Pressable>
        <Pressable
          style={{ flex: 1 }}
          accessibilityRole="button"
          accessibilityLabel={`Money out ${m(c.moneyOutMinor)}. See the transactions.`}
          onPress={() => openDrilldown(c.drilldowns.moneyOut, "Money out")}
        >
          <StatTile label="Money out" value={m(c.moneyOutMinor)} hint={`${c.countOut} ${c.countOut === 1 ? "transaction" : "transactions"}`} />
        </Pressable>
      </View>

      <Card style={{ gap: space[1] }}>
        <Text variant="caption" color="textMuted">
          Net
        </Text>
        <Text variant="title" tabular>
          {c.netMinor > BigInt(0) ? "+" : ""}
          {m(c.netMinor)}
        </Text>
        <Badge variant={net}>{net === "positive" ? "More came in than went out" : net === "attention" ? "More went out than came in" : "Even"}</Badge>
        {c.compare ? (
          <View style={{ gap: 2, marginTop: space[2] }}>
            <Text variant="caption" color="textSecondary">
              Money in: {compareText(c.compare.moneyIn, c.currency)}
            </Text>
            <Text variant="caption" color="textSecondary">
              Money out: {compareText(c.compare.moneyOut, c.currency)}
            </Text>
          </View>
        ) : null}
      </Card>

      {c.cashOutMinor > BigInt(0) ? (
        <Text variant="label" color="textSecondary">
          Includes {m(c.cashOutMinor)} withdrawn as cash - money you took out, not necessarily spent.
        </Text>
      ) : null}
      {c.transfersExcluded.count > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See transfers between your own wallets, which are not counted"
          onPress={() => openDrilldown(c.drilldowns.transfers, "Transfers between your wallets")}
        >
          <Text variant="caption" color="textMuted">
            {c.transfersExcluded.count} transactions are transfers between your own wallets and are not counted. See them
          </Text>
        </Pressable>
      ) : null}
      {c.pending.count > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See pending transactions, which are not counted yet"
          onPress={() => openDrilldown(c.drilldowns.pending, "Pending")}
        >
          <Text variant="caption" color="textMuted">
            {c.pending.count} {c.pending.count === 1 ? "transaction is" : "transactions are"} still pending and not counted yet. See {c.pending.count === 1 ? "it" : "them"}
          </Text>
        </Pressable>
      ) : null}

      <Card style={{ gap: space[3] }}>
        <Text variant="bodyStrong">Where it went</Text>
        {c.byCategory.length === 0 ? (
          <Text variant="label" color="textMuted">
            No spending in this period.
          </Text>
        ) : (
          c.byCategory.map((row) => (
            <Pressable
              key={row.category}
              accessibilityRole="button"
              accessibilityLabel={`${categorySummary(row.category, row.amountMinor, row.percentBps, row.count, c.currency)}. See the transactions.`}
              onPress={() => openDrilldown(row.drilldown, row.category)}
              style={{ gap: space[1] }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
                <Text variant="label" style={{ flexShrink: 1 }}>
                  {row.category}
                </Text>
                <Text variant="label" tabular>
                  {m(row.amountMinor)} · {formatBps(row.percentBps)}
                </Text>
              </View>
              <ProgressBar fraction={bpsFraction(row.percentBps)} label={`${row.category} share of money out`} />
            </Pressable>
          ))
        )}
      </Card>

      {c.topPeople.length > 0 ? (
        <Card style={{ gap: space[2] }}>
          <Text variant="bodyStrong">People and merchants</Text>
          {c.topPeople.slice(0, 5).map((p) => {
            const personId = personIdFromKey(p.key);
            const row = (
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
              <Text variant="label" style={{ flexShrink: 1 }}>
                {p.displayName}
              </Text>
              <Text variant="label" color="textSecondary" tabular>
                {p.sentMinor > BigInt(0) ? `Sent ${m(p.sentMinor)}` : ""}
                {p.sentMinor > BigInt(0) && p.receivedMinor > BigInt(0) ? " · " : ""}
                {p.receivedMinor > BigInt(0) ? `Got ${m(p.receivedMinor)}` : ""}
              </Text>
            </View>
            );
            return personId ? (
              <Pressable
                key={p.key}
                accessibilityRole="button"
                accessibilityLabel={`${p.displayName}. Open.`}
                onPress={() => router.push({ pathname: "/person/[id]", params: { id: personId } })}
              >
                {row}
              </Pressable>
            ) : (
              <View key={p.key}>{row}</View>
            );
          })}
        </Card>
      ) : null}
    </View>
  );
}
