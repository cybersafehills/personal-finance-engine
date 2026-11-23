import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { Text } from "@/components/ds";
import { HomeLink, HomeSection } from "@/features/home/HomeCards";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

import { fetchForecast, type WalletForecast } from "./forecast";
import { fetchIntelligence } from "./intelligence";
import { projectionLines } from "./intelligence-display";
import { BaselineBlock, RecurringBlock, UnusualPaymentsBlock } from "./InsightBlocks";
import { WhyThisInsight } from "./WhyThisInsight";

const HORIZON = 30;

/**
 * Home's "Insights" card - the app's version of the web Home card: the default
 * wallet's 30-day projection, spending vs your usual pace, unusually large
 * payments and recurring payments. Each part loads on its own and the whole
 * card stays out of the way (renders nothing) when the feature is off for this
 * Space, there is nothing to say, or the server is unavailable - Home itself
 * never waits on it or breaks because of it.
 */
export function IntelligenceCard() {
  const { amountsHidden } = usePrivacy();
  const { activeId: workspaceId } = useActiveSpace();
  // Facts first: when the feature is off for this Space the first call answers
  // "unavailable" and nothing else is requested. The forecast is then best-effort.
  const load = useCallback(async () => {
    if (!workspaceId) return null;
    const facts = await fetchIntelligence(workspaceId);
    if (!facts.ok) return null;
    const forecast = await fetchForecast({ workspaceId, accountId: null, days: HORIZON });
    return { facts, wallets: forecast.ok ? forecast.wallets : [] };
  }, [workspaceId]);
  const { data: loaded } = useQuery(load, workspaceId ?? "none");

  const data = loaded?.facts ?? null;
  const wallets = loaded?.wallets ?? [];
  const wallet: WalletForecast | null =
    wallets.find((w) => w.id === data?.defaultWalletId) ?? wallets[0] ?? null;

  if (!data && !wallet) return null;
  const empty = !wallet && !data?.baseline && (data?.anomalies.length ?? 0) === 0 && (data?.recurring.length ?? 0) === 0;
  if (empty) return null;

  const projection = wallet ? projectionLines(wallet, HORIZON, amountsHidden) : null;

  return (
    <HomeSection
      title="Insights"
      subtitle="Your outlook and spending pace, from your own ledger"
      action={wallet ? <HomeLink label="Full forecast" onPress={() => router.push("/forecast")} /> : undefined}
    >
      {wallet && projection ? (
        <View style={{ gap: space[1] }}>
          <Text variant="bodyStrong">{projection.heading}</Text>
          <Text color="textSecondary">{projection.detail}</Text>
          {wallet.low ? (
            <Text variant="caption" color="attention" accessibilityLiveRegion="polite">
              {`Your balance could dip below zero around day ${wallet.low.day} if spending continues at your recent pace.`}
            </Text>
          ) : null}
          <Text variant="caption" color="textMuted">{wallet.disclaimer}</Text>
          <WhyThisInsight basis={wallet.basis} period={`Next ${HORIZON} days`}
            method="Current balance, plus dated recurring items and bills, minus an estimated flat daily spend from your last 90 days." />
        </View>
      ) : null}

      {data ? (
        <>
          {data.baseline ? <BaselineBlock data={data} bare /> : null}
          {data.anomalies.length > 0 ? <UnusualPaymentsBlock data={data} bare limit={4} /> : null}
          {data.recurring.length > 0 ? <RecurringBlock data={data} bare limit={5} /> : null}
        </>
      ) : null}
    </HomeSection>
  );
}
