import { GuideSuggestion } from "@/features/guides/GuideSuggestion";
import { GuideAnchor } from "@/features/guides/GuideAnchor";
import Feather from "@expo/vector-icons/Feather";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, RefreshControl, SectionList, View, type TextInputInstance } from "react-native";

import {
  Button,
  EmptyState,
  ListScreen,
  listContentStyle,
  ScreenHeader,
  Text,
  TextField,
} from "@/components/ds";
import { useChromeScroll } from "@/components/shell/useChromeScroll";
import { groupByDay } from "@/features/transactions/display";
import { LifetimeChips } from "@/features/transactions/LifetimeChips";
import {
  getLifetimeFlowTotals,
  getReviewQueueCount,
  getTransactions,
  TRANSACTIONS_PAGE_SIZE,
  type TransactionRow,
} from "@/features/transactions/queries";
import { FilterChips } from "@/features/transactions/FilterChips";
import { activeFilterCount, NO_FILTERS, type TransactionFilters } from "@/features/transactions/filters";
import { TransactionItem } from "@/features/transactions/TransactionItem";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { subscribeRuntime } from "@/offline/runtime";
import { useOffline } from "@/offline/offline-context";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/ThemeProvider";

const SEARCH_DEBOUNCE_MS = 350;

// The header extras: the lifetime chips and the review-queue count. Loaded on
// their own so a slow total never delays the list.
async function loadHeaderStats(workspaceId: string | null) {
  const [lifetime, reviewCount] = await Promise.all([
    getLifetimeFlowTotals(workspaceId),
    getReviewQueueCount(workspaceId).catch(() => 0),
  ]);
  return { lifetime, reviewCount };
}

// The full ledger: newest first, grouped by day, searchable, loaded a page
// at a time. Amounts here are never masked (a deliberate destination).
export default function Transactions() {
  const { activeId } = useActiveSpace();
  const params = useLocalSearchParams<{ category?: string | string[]; period?: string; reset?: string; accountId?: string; walletName?: string; focusSearch?:string }>();
  const category = (Array.isArray(params.category) ? params.category[0] : params.category) || undefined;
  return <TransactionsList key={`${activeId ?? "pending"}:${params.reset ?? ""}:${params.accountId ?? ""}`} category={category} initialPeriod={params.period} accountId={params.accountId} walletName={params.walletName} focusSearch={params.focusSearch} />;
}

function TransactionsList({ category, initialPeriod, accountId, walletName, focusSearch }: { category?: string; initialPeriod?: string; accountId?: string; walletName?: string; focusSearch?:string }) {
  const { colors } = useTheme();
  const onScroll=useChromeScroll();
  const { activeId } = useActiveSpace();
  const { syncNow } = useOffline();
  const listRef = useRef<SectionList<TransactionRow>>(null);
  const revealFirst = useCallback(() => listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: false, viewPosition: 0 }), []);
  const revealReview = useCallback(() => listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: false }), []);
  const searchRef=useRef<TextInputInstance>(null);
  useFocusEffect(useCallback(()=>{
    if (!focusSearch) return;
    const timer=setTimeout(()=>{searchRef.current?.focus();router.setParams({focusSearch:undefined});},150);
    return ()=>clearTimeout(timer);
  },[focusSearch]));
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TransactionFilters>({ ...NO_FILTERS, period: initialPeriod === "month" ? "month" : "all" });
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(() => new Date().toISOString());
  const requestId = useRef(0);
  const moreInFlight = useRef(false);
  const viewKey = JSON.stringify([activeId, query, filters, category, accountId]);
  const [pageKey, setPageKey] = useState(viewKey);
  const displayedRows = pageKey === viewKey ? rows : [];
  const pageKeyRef = useRef(pageKey);
  const loadStats = useCallback(() => loadHeaderStats(activeId), [activeId]);
  const { data: stats } = useQuery(loadStats, { refreshIntervalMs: 60000 });
  // Debounce typing into the applied query.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const loadFirstPage = useCallback(
    async (userInitiated: boolean) => {
      const id = ++requestId.current;
      if (userInitiated) setRefreshing(true);
      setError(null);
      try {
        if (userInitiated) await syncNow().catch(() => {});
        const page = await getTransactions({ q: query, filters, category, accountId, workspaceId: activeId });
        if (id !== requestId.current) return;
        setRows(page);
        pageKeyRef.current = viewKey;
        setPageKey(viewKey);
        setHasMore(page.length === TRANSACTIONS_PAGE_SIZE);
        setLoadedAt(new Date().toISOString());
        setError(null);
      } catch {
        if (id !== requestId.current) return;
        setError("Couldn't load transactions. Check your connection and try again.");
        if (pageKeyRef.current !== viewKey) setRows([]);
        pageKeyRef.current = viewKey;
        setPageKey(viewKey);
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [query, filters, category, accountId, activeId, viewKey, syncNow],
  );

  // Reloads on focus and whenever the applied search changes.
  useFocusEffect(
    useCallback(() => {
      void loadFirstPage(false);
      void syncNow().catch(() => {});
      const unsubscribe = subscribeRuntime(() => void loadFirstPage(false));
      const app = AppState.addEventListener("change", (state) => { if (state === "active") void loadFirstPage(false); });
      const timer = setInterval(() => { void syncNow().catch(() => {}).finally(() => loadFirstPage(false)); }, 60000);
      return () => { requestId.current++; unsubscribe(); app.remove(); clearInterval(timer); };
    }, [loadFirstPage, syncNow]),
  );

  async function loadMore() {
    if (moreInFlight.current || !hasMore || pageKey !== viewKey) return;
    moreInFlight.current = true;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const page = await getTransactions({ q: query, filters, category, accountId, offset: rows.length, workspaceId: activeId });
      // A refresh or new search started meanwhile: this page is stale.
      if (id !== requestId.current) return;
      const seen = new Set(rows.map((row) => row.id));
      setRows([...rows, ...page.filter((row) => !seen.has(row.id))]);
      setHasMore(page.length === TRANSACTIONS_PAGE_SIZE);
    } catch {
      // Keep what is shown; the button stays for another try.
    } finally {
      moreInFlight.current = false;
      setLoadingMore(false);
    }
  }

  return (
    <ListScreen edges={["left", "right"]}>
      {/* Search and filters stay put above the list, so they are always one thumb away. */}
      <View style={{ paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[2], gap: space[2], backgroundColor: colors.background }}>
        <GuideAnchor id="transactions-search"><TextField
          compact
          label="Search"
          inputRef={searchRef}
          autoFocus={!!focusSearch}
          value={input}
          onChangeText={setInput}
          placeholder="Search name, reference or category"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          leading={<Feather name="search" size={16} color={colors.textMuted} />}
        /></GuideAnchor>
        {accountId ? <View style={{flexDirection:"row",alignItems:"center",gap:8}}><Text variant="label" style={{flex:1}}>{walletName || "Selected wallet"}</Text><Button label="All wallets" size="sm" variant="ghost" onPress={() => router.setParams({accountId:undefined,walletName:undefined})} /></View> : null}
        {category ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] }}>
            <Text variant="label" color="textSecondary" style={{ flex: 1 }}>
              {`Category: ${category}`}
            </Text>
            <Button label="Clear" size="sm" variant="ghost" onPress={() => router.setParams({ category: undefined })} />
          </View>
        ) : null}
        <GuideAnchor id="transactions-filters"><FilterChips value={filters} onChange={setFilters} /></GuideAnchor>
      </View>
      <SectionList
        ref={listRef}
        onScroll={onScroll}
        scrollEventThrottle={32}
        sections={groupByDay(displayedRows, loadedAt)}
        keyExtractor={(row) => row.id}
        contentContainerStyle={listContentStyle}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadFirstPage(true)}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space[2] }}>
            <ScreenHeader
              inline
              title="Transactions"
              action={
                <Button
                  label="Add"
                  size="sm"
                  variant="secondary"
                  accessibilityLabel="Add transaction"
                  onPress={() => router.push("/add-transaction")}
                />
              }
            />
            <GuideSuggestion id={stats && stats.reviewCount > 0 && !accountId ? "inbox" : "transaction"} enabled={!loading && !error && displayedRows.length > 0} />
            {error && displayedRows.length > 0 ? <View style={{ gap: 8 }}><Text color="attention">{error} Showing previously loaded transactions.</Text><Button label="Try again" onPress={() => void loadFirstPage(true)} variant="secondary" /></View> : null}
            {stats && !accountId ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space[2] }}>
                <LifetimeChips totals={stats.lifetime} accountCreatedIso={stats.lifetime.accountCreatedIso} />
                <GuideAnchor id="review-queue" reveal={revealReview}><Button
                  label={stats.reviewCount > 0 ? `Review queue (${stats.reviewCount})` : "Review queue"}
                  size="sm"
                  variant="ghost"
                  onPress={() => router.push("/inbox")}
                /></GuideAnchor>
              </View>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text
            variant="caption"
            color="textMuted"
            accessibilityRole="header"
            style={{ marginTop: space[4], marginBottom: space[1], paddingHorizontal: space[1] }}
          >
            {section.title.toUpperCase()}
          </Text>
        )}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: colors.surface }}>
            <GuideAnchor id="first-transaction" enabled={item.id === displayedRows[0]?.id} reveal={revealFirst} follow={() => router.push({ pathname: "/transaction/[id]", params: { id: item.id } })}><TransactionItem transaction={item} masked={false} /></GuideAnchor>
          </View>
        )}
        ListEmptyComponent={
          loading || (pageKey !== viewKey && !error) ? (
            <Text variant="label" color="textMuted" style={{ marginTop: space[4] }}>
              Loading…
            </Text>
          ) : error ? (
            <EmptyState
              title={error}
              action={
                <Button label="Try again" variant="secondary" onPress={() => loadFirstPage(true)} />
              }
            />
          ) : (
            <EmptyState
              title={query.trim() || activeFilterCount(filters) || category ? "Nothing matches that search" : "No transactions yet"}
              description={
                query.trim() || activeFilterCount(filters) || category
                  ? "Try a different name, reference or category, or clear the filters."
                  : "They appear here as OneLedger records them."
              }
            />
          )
        }
        ListFooterComponent={
          hasMore && pageKey === viewKey ? (
            <View style={{ marginTop: space[4] }}>
              <Button
                label="Show more"
                variant="secondary"
                fullWidth
                loading={loadingMore}
                onPress={loadMore}
              />
            </View>
          ) : undefined
        }
      />
    </ListScreen>
  );
}
