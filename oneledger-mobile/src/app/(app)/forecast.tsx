import { useCallback, useState } from "react";
import { View } from "react-native";

import { Button, Card, Chip, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { ForecastChart } from "@/features/insights/ForecastChart";
import { fetchForecast, FORECAST_DAYS, type ForecastDays, type WalletForecast } from "@/features/insights/forecast";
import { fetchIntelligence } from "@/features/insights/intelligence";
import { scheduledItems } from "@/features/insights/intelligence-display";
import { BaselineBlock, RecurringBlock, UnusualPaymentsBlock } from "@/features/insights/InsightBlocks";
import { OwnAccountPrompt } from "@/features/insights/OwnAccountPrompt";
import { WhyThisInsight } from "@/features/insights/WhyThisInsight";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";

// The app's version of the web's /inbox/forecast: a conservative outlook for each
// wallet from its own ledger - the projected balance as a chart AND as words, the
// dated commitments, then spending vs. your usual pace, unusually large payments
// and recurring payments. Deterministic facts only; every block can say why it is
// shown. Estimates are labelled as estimates.

export default function Forecast() {
  const { activeId } = useActiveSpace();
  // Keyed by Space so a switch never shows the previous Space's figures.
  return activeId ? <ForecastForSpace key={activeId} workspaceId={activeId} /> : (
    <Screen><ScreenHeader title="Cash-flow forecast" /><Text variant="label" color="textMuted">Loading…</Text></Screen>
  );
}

function ForecastForSpace({ workspaceId }: { workspaceId: string }) {
  const [days, setDays] = useState<ForecastDays>(30);
  const [walletId, setWalletId] = useState<string | null>(null);
  const loadForecast = useCallback(() => fetchForecast({ workspaceId, accountId: null, days }), [workspaceId, days]);
  const forecast = useQuery(loadForecast, `${workspaceId}|${days}`);
  const loadFacts = useCallback(() => fetchIntelligence(workspaceId), [workspaceId]);
  const facts = useQuery(loadFacts, workspaceId);

  const result = forecast.data;
  const factsData = facts.data?.ok ? facts.data : null;
  const allWallets = result && result.ok ? result.wallets : [];
  // A wallet picker only when there is a choice; filtering is local (one request covers every wallet).
  const wallets = walletId ? allWallets.filter((w) => w.id === walletId) : allWallets;
  const estimatesIncome = allWallets.some((w) => w.estimatesIncome);
  const unavailable = result && !result.ok && result.reason === "unavailable";

  return (
    <Screen>
      <ScreenHeader title="Cash-flow forecast" subtitle="A conservative outlook for each wallet, from its own ledger: your recent pace, nothing more." />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {FORECAST_DAYS.map((d) => <Chip key={d} label={`Next ${d} days`} selected={d === days} onPress={() => setDays(d)} />)}
      </View>

      {allWallets.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityLabel="Wallet">
          <Chip label="All wallets" selected={walletId === null} onPress={() => setWalletId(null)} />
          {allWallets.map((w) => <Chip key={w.id} label={w.name} selected={walletId === w.id} onPress={() => setWalletId(w.id)} />)}
        </View>
      ) : null}

      {!result && forecast.loading ? (
        <Text variant="label" color="textMuted" accessibilityLiveRegion="polite">Loading forecast…</Text>
      ) : unavailable ? (
        <EmptyState title={result.message} />
      ) : (forecast.error || (result && !result.ok)) ? (
        <EmptyState title={result && !result.ok ? result.message : "Couldn’t load the forecast."}
          action={<Button label="Try again" variant="secondary" onPress={() => { forecast.refresh(); facts.refresh(); }} />} />
      ) : result && result.ok ? (
        result.wallets.length === 0 ? (
          <EmptyState title="No forecast yet" description="A forecast needs a recorded RWF balance for a wallet, and some history to learn your pace from." />
        ) : (
          <>
            <Text variant="caption" color="textMuted">{`Calculated ${formatDateTime(result.computedAt)}.`}</Text>
            {wallets.map((wallet) => <WalletOutlook key={wallet.id} wallet={wallet} days={days} showName={allWallets.length > 1} />)}
          </>
        )
      ) : null}

      {estimatesIncome ? <OwnAccountPrompt onChanged={() => { forecast.refresh(); facts.refresh(); }} /> : null}

      {factsData ? (
        <>
          <BaselineBlock data={factsData} />
          <UnusualPaymentsBlock data={factsData} />
          <RecurringBlock data={factsData} />
        </>
      ) : null}
    </Screen>
  );
}

function WalletOutlook({ wallet, days, showName }: { wallet: WalletForecast; days: number; showName: boolean }) {
  const { amountsHidden, fullPrivacy } = usePrivacy();
  const hidden = amountsHidden || fullPrivacy;
  const money = (value: bigint) => hidden ? "Amount hidden" : formatMoney(value, "RWF");
  const items = scheduledItems(wallet);
  return (
    <View style={{ gap: space[3] }}>
      {showName ? <Text variant="heading">{wallet.name}</Text> : null}
      <Card style={{ gap: space[3] }}>
        {wallet.balanceAsOf ? <Text variant="caption" color="textMuted">{`Starting balance ${money(wallet.opening)} as of ${formatDateTime(wallet.balanceAsOf)}.`}</Text> : null}
        <ForecastChart wallet={wallet} days={days} />
        <Figure label={`In ${days} days · scheduled items only`} value={money(wallet.scheduledEnd)} />
        <Figure label={`…with everyday spending${wallet.estimatesIncome ? " and your usual income" : ""}`} value={money(wallet.estimatedEnd)} />
        {wallet.estimatesIncome ? <Figure label="…with everyday spending but nothing new coming in (the cautious end)" value={money(wallet.noIncomeEnd)} /> : null}
        {wallet.low ? (
          <Text color="attention" accessibilityLiveRegion="polite">
            {`Your balance could dip below zero around day ${wallet.low.day} if spending continues at your recent pace (${money(wallet.low.amount)} at the low).`}
          </Text>
        ) : null}
        <Text variant="caption" color="textMuted">{wallet.disclaimer}</Text>
        <WhyThisInsight basis={wallet.basis} period={`Next ${days} days`}
          method="Current balance, plus dated recurring items and bills, minus an estimated flat daily spend from your last 90 days." />
      </Card>

      <Card style={{ gap: space[2] }}>
        <Text variant="bodyStrong">{`Dated commitments in the next ${days} days`}</Text>
        {items.length === 0 ? (
          <Text variant="caption" color="textMuted">None detected. The estimate above is everyday spending only.</Text>
        ) : items.map((item) => (
          <View key={`${item.day}-${item.label}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}
            accessible accessibilityLabel={`Day ${item.day}, ${item.label}, ${item.delta === 0n ? "no change" : money(item.delta)}, balance ${money(item.balance)}`}>
            <View style={{ flexShrink: 1 }}>
              <Text>{item.label}</Text>
              <Text variant="caption" color="textMuted">{`In ${item.day} days`}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text tabular>{item.delta === 0n ? "—" : money(item.delta)}</Text>
              <Text variant="caption" color="textMuted" tabular>{money(item.balance)}</Text>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="caption" color="textMuted">{label}</Text>
      <Text variant="bodyStrong" tabular>{value}</Text>
    </View>
  );
}
