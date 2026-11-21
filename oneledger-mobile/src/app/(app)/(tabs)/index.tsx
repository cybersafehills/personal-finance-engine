import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Chip, EmptyState, Text } from "@/components/ds";
import { fetchWallets, fetchBudgets } from "@/api/mobile-api";
import { useSession } from "@/features/auth/SessionProvider";
import { HomeHeader, HeroBalance, CashFlow, Spending, WalletPanel, HomeSection, HomeLink } from "@/features/home/HomeCards";
import { BudgetOutlook } from "@/features/home/BudgetOutlook";
import { TrendChart } from "@/features/home/Charts";
import { currencyBlock, fillTrend, loadHomeInsights, profileName } from "@/features/home/live-data";
import { getCurrentBalance, getTransactions } from "@/features/transactions/queries";
import { TransactionItem } from "@/features/transactions/TransactionItem";
import { getUnreadNotificationCount } from "@/features/notifications/queries";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { useQuery } from "@/hooks/useQuery";
import { useOffline } from "@/offline/offline-context";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import type { SupportedCurrency } from "@/lib/money";
import { kigaliDateKey } from "@/lib/kigali-time";

export default function Home() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { session } = useSession();
  const { activeId } = useActiveSpace();
  const offline = useOffline();
  const syncNow = offline.syncNow;
  const [now, setNow] = useState(() => new Date());
  const [pulling, setPulling] = useState(false);
  const [months, setMonths] = useState<3 | 6>(6);
  const [choice, setChoice] = useState<{ space: string | null; currency: SupportedCurrency } | null>(null);
  const day = kigaliDateKey(now.toISOString());
  useFocusEffect(useCallback(() => {
    void syncNow().catch(() => {});
    const timer = setInterval(() => { void syncNow().catch(() => {}); }, 60000);
    return () => clearInterval(timer);
  }, [syncNow]));
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    const app = AppState.addEventListener("change", (s) => { if (s === "active") setNow(new Date()); });
    return () => { clearInterval(timer); app.remove(); };
  }, []);
  const loadWallets = useCallback(() => { if (!activeId) throw new Error("Space is loading"); return fetchWallets(); }, [activeId]);
  const walletsQuery = useQuery(loadWallets, { refreshIntervalMs: 60000 });
  const loadRecent = useCallback(async () => {
    const [recent, balance] = await Promise.all([getTransactions({ limit: 3, workspaceId: activeId }), getCurrentBalance(activeId).catch(() => null)]);
    return { recent, balance };
  }, [activeId]);
  const recentQuery = useQuery(loadRecent, { refreshIntervalMs: 60000 });
  const loadAnalytics = useCallback(() => { if (!activeId || !day) throw new Error("Space is loading"); return loadHomeInsights(new Date()); }, [activeId, day]);
  const analytics = useQuery(loadAnalytics, { refreshIntervalMs: 60000 });
  const loadBudget = useCallback(() => { if (!activeId) throw new Error("Space is loading"); return fetchBudgets(); }, [activeId]);
  const budget = useQuery(loadBudget, { refreshIntervalMs: 60000 });
  const profile = useQuery(profileName);
  const unread = useQuery(getUnreadNotificationCount);
  const meta = session?.user.user_metadata;
  const fallbackName = typeof meta?.full_name === "string" ? meta.full_name : typeof meta?.name === "string" ? meta.name : "there";
  const name = profile.data ?? fallbackName;
  const wallets = walletsQuery.data?.ok ? walletsQuery.data.wallets : null;
  const currency = choice?.space === activeId ? choice.currency : wallets?.find((w) => w.isPrimary)?.currency ?? "RWF";
  const currencyOptions = [...new Set<SupportedCurrency>([...(wallets ?? []).map((w) => w.currency), ...(analytics.data?.current.ok ? analytics.data.current.overview.currencies.map((c) => c.currency) : []), currency])];
  const currentResult = analytics.data?.current;
  const historyResult = analytics.data?.history;
  const current = currencyBlock(currentResult, currency);
  const history = currencyBlock(historyResult, currency);
  const points = history?.trend && analytics.data ? fillTrend(history.trend, analytics.data.periods.trendFrom, analytics.data.fetchedAt).slice(-months) : [];
  const analyticsMessage = currentResult && !currentResult.ok ? currentResult.message : analytics.error ?? (analytics.loading ? "Loading your monthly activity…" : "No summary is available.");
  const walletsMessage = walletsQuery.data && !walletsQuery.data.ok ? walletsQuery.data.message : walletsQuery.error ?? (walletsQuery.loading ? "Loading your wallets…" : "Your wallets are unavailable.");
  async function refresh() {
    setPulling(true);
    try { await offline.syncNow(); } catch { /* Query errors below keep saved data visible. */ }
    finally { setNow(new Date()); walletsQuery.refresh(); recentQuery.refresh(); analytics.refresh(); budget.refresh(); profile.refresh(); unread.refresh(); setPulling(false); }
  }
  if (!activeId) return <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}><View style={styles.content}><Text color="textMuted">Loading your workspace. Connect to load your Spaces if this is your first launch.</Text></View></SafeAreaView>;
  return <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={pulling || walletsQuery.refreshing || recentQuery.refreshing || analytics.refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}>
      <HomeHeader name={name} now={now} unread={unread.data ?? 0} />
      {offline.status.kind === "offline" ? <Text variant="caption" color="attention">Offline · Showing saved transactions. Wallet and analytics updates need a connection.</Text> : null}
      {walletsQuery.error && wallets ? <Text variant="caption" color="attention">Couldn&apos;t refresh wallet balances. Showing the last fetched figures.</Text> : null}
      {analytics.error && analytics.data ? <Text variant="caption" color="attention">Couldn&apos;t refresh analytics. Showing the last fetched summary.</Text> : null}
      {currencyOptions.length > 1 ? <View style={styles.currencies}>{currencyOptions.map((c) => <Chip key={c} label={c} selected={currency === c} onPress={() => setChoice({ space: activeId, currency: c })} />)}</View> : null}
      <HeroBalance key={`${session?.user.id}:${activeId}`} preferenceScope={`${session?.user.id ?? "unknown"}.${activeId}`} wallets={wallets} currency={currency} fallback={recentQuery.data?.balance ?? null} loading={walletsQuery.loading || recentQuery.loading} />
      <CashFlow currency={currency} current={current} today={currencyBlock(analytics.data?.today,currency)} todayAvailable={analytics.data?.today.ok === true} available={currentResult?.ok === true} message={analyticsMessage} />
      <HomeSection title="Recent transactions" dense action={<HomeLink label="View all" onPress={() => router.navigate({ pathname: "/transactions", params: { category: "", accountId:"", walletName:"", period: "all", reset: String(Date.now()) } })} />}>
        {recentQuery.error ? <View style={{ gap: 8 }}><Text color="attention">Couldn&apos;t refresh transactions.</Text><Button label="Try again" variant="secondary" onPress={recentQuery.refresh} /></View> : null}
        {recentQuery.loading ? <Text color="textMuted">Loading transactions…</Text> : !recentQuery.data?.recent.length && !recentQuery.error ? <EmptyState title="No transactions yet" description="New transactions will appear here as they are recorded." /> : <View>{recentQuery.data?.recent.slice(0, 3).map((t) => <TransactionItem key={t.id} transaction={t} showDate compact />)}</View>}
      </HomeSection>
      <BudgetOutlook result={budget.data} currency={currency} now={now} error={budget.error} />
      <Spending current={current} available={currentResult?.ok === true} message={analyticsMessage} />
      <HomeSection title="Cash flow trends" collapsible subtitle={`Income and expenses · ${currency}`} action={<Pressable accessibilityRole="button" accessibilityLabel={`Show last ${months === 6 ? 3 : 6} months`} onPress={() => setMonths(months === 6 ? 3 : 6)} style={styles.period}><Text variant="caption" color="textMuted">Last {months} months ⌄</Text></Pressable>}>
        {historyResult?.ok ? <TrendChart points={points} currency={currency} /> : <Text color="textMuted">{historyResult && !historyResult.ok ? historyResult.message : analytics.loading ? "Loading your trend…" : analyticsMessage}</Text>}
      </HomeSection>
      <WalletPanel wallets={wallets} message={walletsMessage} />
    </ScrollView>
  </SafeAreaView>;
}
const useStyles = makeStyles((c) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 24, gap: 12, maxWidth: 480, width: "100%", alignSelf: "center" },
  currencies: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  period: { minHeight: 44, padding: 8, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: 10, justifyContent: "center" },
}));
