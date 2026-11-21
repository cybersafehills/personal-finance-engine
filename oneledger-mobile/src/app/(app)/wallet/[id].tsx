import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import { fetchInsights, fetchWallets } from "@/api/mobile-api";
import { Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { WalletCard } from "@/features/wallets/WalletCard";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { getTransactions } from "@/features/transactions/queries";
import { TransactionItem } from "@/features/transactions/TransactionItem";
import { HomeLink, HomeSection } from "@/features/home/HomeCards";
import { currencyBlock, homePeriods, compactMoney } from "@/features/home/live-data";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";

export default function WalletDetail() {
  const { id } = useLocalSearchParams<{id?:string}>();
  const { activeId } = useActiveSpace();
  return <WalletDetails key={`${activeId}:${id}`} id={typeof id === "string" ? id : ""} workspaceId={activeId} />;
}
function WalletDetails({id,workspaceId}:{id:string;workspaceId:string|null}) {
  const { amountsHidden } = usePrivacy();
  const load = useCallback(() => {if (!workspaceId || !id) throw new Error("Select a wallet"); return fetchWallets();},[workspaceId,id]);
  const wallets = useQuery(load,{refreshIntervalMs:60000});
  const wallet = wallets.data?.ok ? wallets.data.wallets.find(w => w.id === id) : null;
  const loadActivity = useCallback(async () => workspaceId && id ? getTransactions({workspaceId,accountId:id,limit:10}) : null,[workspaceId,id]);
  const activity = useQuery(loadActivity,{refreshIntervalMs:60000});
  const loadFlow = useCallback(async () => {
    if (!workspaceId || !id) return null;
    const period=homePeriods(new Date());
    return fetchInsights({from:period.from,to:period.to,accountIds:[id]});
  },[workspaceId,id]);
  const flow = useQuery(loadFlow,{refreshIntervalMs:60000});
  const refresh = () => {wallets.refresh();activity.refresh();flow.refresh();};
  if (wallets.error || (wallets.data && !wallets.data.ok)) return <Screen><ScreenHeader title="Wallet" /><EmptyState title={wallets.error ?? (wallets.data && !wallets.data.ok ? wallets.data.message : "Wallet unavailable")} action={<Button label="Try again" onPress={refresh} />} /></Screen>;
  if (!wallets.data) return <Screen><ScreenHeader title="Wallet" /><Text>Loading wallet…</Text></Screen>;
  if (!wallet) return <Screen><ScreenHeader title="Wallet" /><EmptyState title="Wallet not found in this Space" description="Choose a wallet from your current Space." action={<Button label="Your wallets" onPress={() => router.replace("/wallets")} />} /></Screen>;
  const month=currencyBlock(flow.data ?? undefined,wallet.currency);
  return <Screen>
    <ScreenHeader title={wallet.name} subtitle={`${wallet.currency}${wallet.isPrimary ? " · Primary wallet" : ""}`} />
    <WalletCard key={wallet.id} wallet={wallet} onSaved={refresh} />
    <Button label="Add transaction" variant="secondary" onPress={() => router.push({pathname:"/add-transaction",params:{accountId:wallet.id}})} />
    <HomeSection title="This wallet · This month">
      {flow.error || (flow.data && !flow.data.ok) ? <View style={{gap:8}}><Text variant="caption">{flow.error ?? (flow.data && !flow.data.ok ? flow.data.message : "Summary unavailable")}</Text><Button label="Retry summary" variant="ghost" onPress={flow.refresh} /></View> : flow.data?.ok ? <View style={{flexDirection:"row",gap:12}}>{[{label:"Income",amount:month?.moneyInMinor ?? 0n},{label:"Expenses",amount:month?.moneyOutMinor ?? 0n}].map(item => <View key={item.label} style={{flex:1,gap:5}}><Text variant="caption" color="textMuted">{item.label}</Text><Text variant="bodyStrong">{amountsHidden ? "••••••" : compactMoney(item.amount,wallet.currency)}</Text></View>)}</View> : <Text variant="caption">Loading wallet summary…</Text>}
      <Text variant="caption" color="textMuted">Settled activity only. Internal transfers excluded.</Text>
    </HomeSection>
    <HomeSection title="Wallet activity" action={<HomeLink label="View all" onPress={() => router.navigate({pathname:"/transactions",params:{focusSearch:"",accountId:wallet.id,walletName:wallet.name,category:"",period:"all",reset:String(Date.now())}})} />}>
      {activity.error ? <EmptyState title="Couldn’t refresh wallet activity" action={<Button label="Retry activity" onPress={activity.refresh} />} /> : null}
      {activity.data === null && !activity.error ? <Text variant="caption">Loading activity…</Text> : !activity.data?.length && !activity.error ? <Text variant="caption">No transactions recorded for this wallet yet.</Text> : activity.data?.map(t => <TransactionItem key={t.id} transaction={t} showDate compact />)}
    </HomeSection>
    <Card><Text variant="caption" color="textMuted">{wallet.latestTxnAt ? `Latest recorded activity: ${formatDateTime(wallet.latestTxnAt)}` : "No recorded activity yet"}</Text></Card>
    <Button label="Refresh wallet" variant="ghost" onPress={refresh} />
  </Screen>;
}
