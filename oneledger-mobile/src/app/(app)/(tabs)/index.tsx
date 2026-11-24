import { insightsCacheKey, mergeInsights, readCachedInsights, writeCachedInsights, type HomeInsights } from "@/features/home/insights-cache";
import { PartnerHomePlacement } from "@/features/partners/PartnerOfferCard";
import { useDockClearance } from "@/components/shell/dockClearance";
import { GuideScrollView } from "@/features/guides/GuideScrollView";
import { GuidesHomeCard } from "@/features/guides/GuidesHomeCard";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Chip, EmptyState, Text } from "@/components/ds";
import { fetchWallets, fetchBudgets } from "@/api/mobile-api";
import { useSession } from "@/features/auth/SessionProvider";
import { HomeHeader, HeroBalance, CashFlow, Spending, WalletPanel, HomeSection, HomeLink } from "@/features/home/HomeCards";
import { BudgetOutlook } from "@/features/home/BudgetOutlook";
import { IntelligenceCard } from "@/features/insights/IntelligenceCard";
import { useOutlookData } from "@/features/insights/useOutlookData";
import { useChromeScroll } from "@/components/shell/useChromeScroll";
import { HomeTrends } from "@/features/home/HomeTrends";
import { currencyBlock, loadHomeInsights, profileName } from "@/features/home/live-data";
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
  const onScroll=useChromeScroll();
  const { colors } = useTheme();
  const { session } = useSession();
  const { activeId } = useActiveSpace();
  const offline = useOffline();
  const syncNow = offline.syncNow;
  const [now, setNow] = useState(() => new Date());
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
  const loadRecent = useCallback(async () => ({ recent: await getTransactions({ limit: 3, workspaceId: activeId }) }), [activeId]);
  const recentQuery = useQuery(loadRecent, { refreshIntervalMs: 60000 });
  const loadBalance = useCallback(() => getCurrentBalance(activeId), [activeId]);
  const balanceQuery = useQuery(loadBalance, { refreshIntervalMs: 60000 });
  const loadAnalytics = useCallback(() => { if (!activeId || !day) throw new Error("Space is loading"); return loadHomeInsights(new Date()); }, [activeId, day]);
  const analytics = useQuery(loadAnalytics, { refreshIntervalMs: 60000 });
  // Cash flow opens with what was there last time, then switches to fresh numbers when they arrive.
  const cacheKey = session && activeId ? insightsCacheKey(session.user.id, activeId) : null;
  const [remembered, setRemembered] = useState<{ key: string; value: HomeInsights } | null>(null);
  useEffect(() => {
    if (!cacheKey) return;
    let off = false;
    void readCachedInsights(cacheKey).then(value => { if (!off && value) setRemembered({ key: cacheKey, value }); });
    return () => { off = true; };
  }, [cacheKey]);
  useEffect(() => { if (cacheKey && analytics.data) void writeCachedInsights(cacheKey, analytics.data); }, [cacheKey, analytics.data]);
  const merged = mergeInsights(analytics.data, remembered && remembered.key === cacheKey ? remembered.value : null, now);
  const insights = merged.data;
  const loadBudget = useCallback(() => { if (!activeId) throw new Error("Space is loading"); return fetchBudgets(); }, [activeId]);
  const budget = useQuery(loadBudget, { refreshIntervalMs: 60000 });
  const profile = useQuery(profileName);
  const unread = useQuery(getUnreadNotificationCount);
  const dock = useDockClearance();
  const meta = session?.user.user_metadata;
  const fallbackName = typeof meta?.full_name === "string" ? meta.full_name : typeof meta?.name === "string" ? meta.name : "there";
  const name = profile.data ?? fallbackName;
  const wallets = walletsQuery.data?.ok ? walletsQuery.data.wallets : null;
  const currency = choice?.space === activeId ? choice.currency : wallets?.find((w) => w.isPrimary)?.currency ?? "RWF";
  // Loaded once for both the outlook card and the Cash flow block; RWF only (the server forecasts RWF).
  const outlook = useOutlookData(currency === "RWF");
  const currencyOptions = [...new Set<SupportedCurrency>([...(wallets ?? []).map((w) => w.currency), ...(insights?.current.ok ? insights.current.overview.currencies.map((c) => c.currency) : []), currency])];
  const currentResult = insights?.current;
  const current = currencyBlock(currentResult, currency);
  const analyticsMessage = currentResult && !currentResult.ok ? currentResult.message : analytics.error ?? (analytics.loading || merged.usingRemembered ? "Loading your monthly activity…" : "No summary is available.");
  const walletsMessage = walletsQuery.data && !walletsQuery.data.ok ? walletsQuery.data.message : walletsQuery.error ?? (walletsQuery.loading ? "Loading your wallets…" : "Your wallets are unavailable.");
  const homeBlock = walletsQuery.loading || recentQuery.loading ? "Home is still loading"
    : walletsQuery.error || recentQuery.error ? "Home couldn’t refresh wallets or transactions"
    : !wallets?.length ? "No wallets are loaded"
    : !recentQuery.data?.recent.length ? "There are no recent transactions yet" : null;
  function refresh() {
    void offline.syncNow().catch(() => {});
    setNow(new Date());
    walletsQuery.refresh(); recentQuery.refresh(); balanceQuery.refresh();
    analytics.refresh(); budget.refresh(); profile.refresh(); unread.refresh();
  }
  if (!activeId) return <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}><View style={styles.content}><Text color="textMuted">Loading your workspace. Connect to load your Spaces if this is your first launch.</Text></View></SafeAreaView>;
  return <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
    <View testID="home-fixed-toolbar" style={styles.toolbar}><HomeHeader name={name} unread={unread.data ?? 0} /></View>
    <GuideScrollView testID="home-content-scroll" style={{flex:1}} onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={[styles.content, { paddingBottom: 24 + dock }]} refreshControl={<RefreshControl refreshing={balanceQuery.refreshing || walletsQuery.refreshing || recentQuery.refreshing || analytics.refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}>
      {offline.status.kind === "offline" ? <Text variant="caption" color="attention">Offline · Showing saved transactions. Wallet and analytics updates need a connection.</Text> : null}
      {walletsQuery.error && wallets ? <Text variant="caption" color="attention">Couldn&apos;t refresh wallet balances. Showing the last fetched figures.</Text> : null}
      {analytics.error && analytics.data ? <Text variant="caption" color="attention">Couldn&apos;t refresh analytics. Showing the last fetched summary.</Text> : null}
      {currencyOptions.length > 1 ? <View style={styles.currencies}>{currencyOptions.map((c) => <Chip key={c} label={c} selected={currency === c} onPress={() => setChoice({ space: activeId, currency: c })} />)}</View> : null}
      <HeroBalance key={`${session?.user.id}:${activeId}`} preferenceScope={`${session?.user.id ?? "unknown"}.${activeId}`} wallets={wallets} currency={currency} fallback={balanceQuery.data ?? null} loading={!wallets && balanceQuery.loading} />
      <GuidesHomeCard loaded={!walletsQuery.loading && !recentQuery.loading && !walletsQuery.error && !recentQuery.error} />
      <CashFlow pace={outlook.data?.facts?.baseline ?? null} currency={currency} current={current} today={currencyBlock(insights?.today,currency)} todayAvailable={insights?.today.ok === true} todayPending={merged.todayPending && !analytics.error} available={currentResult?.ok === true} message={analyticsMessage} />
      <PartnerHomePlacement ready={!homeBlock} blockedBy={homeBlock}/>
      <HomeSection guideId="home-recent" title="Recent transactions" dense action={<HomeLink label="View all" onPress={() => router.navigate({ pathname: "/transactions", params: { focusSearch:"", category: "", accountId:"", walletName:"", period: "all", reset: String(Date.now()) } })} />}>
        {recentQuery.error ? <View style={{ gap: 8 }}><Text color="attention">Couldn&apos;t refresh transactions.</Text><Button label="Try again" variant="secondary" onPress={recentQuery.refresh} /></View> : null}
        {recentQuery.loading ? <Text color="textMuted">Loading transactions…</Text> : !recentQuery.data?.recent.length && !recentQuery.error ? <EmptyState title="No transactions yet" description="New transactions will appear here as they are recorded." /> : <View>{recentQuery.data?.recent.slice(0, 3).map((t) => <TransactionItem key={t.id} transaction={t} showDate compact />)}</View>}
      </HomeSection>
      <BudgetOutlook result={budget.data} currency={currency} now={now} error={budget.error} />
      {/* Forecast and spending pace are RWF-only on the server, so other currencies don't show them. */}
      {currency === "RWF" ? <IntelligenceCard key={`insights.${activeId}`} outlook={outlook.data} error={outlook.error} /> : null}
      <Spending key={`spending.${session?.user.id}.${activeId}`} scope={`${session?.user.id}.${activeId}`} current={current} available={currentResult?.ok === true} message={analyticsMessage} />
      <HomeTrends key={`trends.${session?.user.id}.${activeId}`} scope={`${session?.user.id}.${activeId}`} currency={currency} nowIso={now.toISOString()} day={day}/>
      <WalletPanel wallets={wallets} message={walletsMessage} />
    </GuideScrollView>
  </SafeAreaView>;
}
const useStyles = makeStyles((c) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  toolbar: { paddingHorizontal:16,paddingBottom:8,maxWidth:480,width:"100%",alignSelf:"center",backgroundColor:c.background },
  content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 24, gap: 12, maxWidth: 480, width: "100%", alignSelf: "center" },
  currencies: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  period: { minHeight: 44, padding: 8, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: 10, justifyContent: "center" },
}));
