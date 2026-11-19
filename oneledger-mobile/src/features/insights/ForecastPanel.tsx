import { useCallback, useState } from "react";
import { View } from "react-native";

import { formatAmount } from "../../../../shared/financial";
import { Button, Card, Chip, Text } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { space } from "@/theme/tokens";
import { fetchForecast, FORECAST_DAYS, type ForecastDays, type WalletForecast } from "./forecast";

export function ForecastPanel({ workspaceId, accountId }: { workspaceId: string; accountId: string | null }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<ForecastDays>(30);
  const load = useCallback(() => open ? fetchForecast({ workspaceId, accountId, days }) : Promise.resolve(null), [workspaceId, accountId, days, open]);
  const query = useQuery(load, `${workspaceId}|${accountId ?? "all"}|${days}|${open}`);
  const result = query.data;

  return (
    <Card style={{ gap: space[2] }}>
      <Button label={open ? "Hide cash-flow forecast" : "Show cash-flow forecast"} variant="secondary"
        accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} />
      {open ? (
        <>
          <Text variant="caption">Choose how far ahead to look. The forecast starts today and uses recent activity.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {FORECAST_DAYS.map((day) => (
              <Chip key={day} label={`Next ${day} days`} selected={day === days} onPress={() => setDays(day)} />
            ))}
          </View>
          {query.error || (result && !result.ok) ? (
            <>
              <Text accessibilityLiveRegion="polite">{result && !result.ok ? result.message : "Couldn’t load the forecast."}</Text>
              <Button label="Retry forecast" variant="ghost" onPress={query.refresh} />
            </>
          ) : !result ? (
            <Text accessibilityLiveRegion="polite">Loading forecast…</Text>
          ) : result.wallets.length === 0 ? (
            <Text>No RWF forecast is available for the selected wallets. A recorded provider balance is needed.</Text>
          ) : (
            <>
              <Text variant="caption" color="textMuted">Calculated {formatDateTime(result.computedAt)}.</Text>
              {result.wallets.map((wallet) => <WalletOutlook key={wallet.id} wallet={wallet} />)}
            </>
          )}
        </>
      ) : null}
    </Card>
  );
}

function WalletOutlook({ wallet }: { wallet: WalletForecast }) {
  const { amountsHidden } = usePrivacy();
  const [details, setDetails] = useState(false);
  const money = (value: bigint) => amountsHidden ? "Amount hidden" : formatAmount(value, "RWF", false);
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="heading">{wallet.name}</Text>
      <Text>{`Starting balance: ${money(wallet.opening)}`}</Text>
      {wallet.balanceAsOf ? <Text variant="caption">Balance as of {formatDateTime(wallet.balanceAsOf)}.</Text> : null}
      <Text>{`Scheduled items only: ${money(wallet.scheduledEnd)}`}</Text>
      <Text>{`Estimated closing balance: ${money(wallet.estimatedEnd)}`}</Text>
      {wallet.estimatesIncome ? <Text>{`If no new income arrives: ${money(wallet.noIncomeEnd)}`}</Text> : null}
      {wallet.low ? (
        <Text color="attention">{`The balance may fall below zero around day ${wallet.low.day}: ${money(wallet.low.amount)}.`}</Text>
      ) : null}
      <Text variant="caption" color="textMuted">{wallet.disclaimer}</Text>
      <Button label={details ? "Hide forecast details" : "Show forecast details"} variant="ghost"
        accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} />
      {details ? (
        <>
          {wallet.basis.map((line) => <Text key={line} variant="caption">{line}</Text>)}
          {wallet.points.map((point) => (
            <View key={point.day} style={{ gap: 2 }}>
              <Text variant="label">{point.day === 0 ? point.label : `Day ${point.day} · ${point.label}`}</Text>
              <Text variant="caption">{`Scheduled ${money(point.scheduled)} · Estimated ${money(point.estimated)}`}</Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}
