import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, SectionList, View } from "react-native";

import {
  Button,
  EmptyState,
  ListScreen,
  listContentStyle,
  ScreenHeader,
  Text,
  TextField,
} from "@/components/ds";
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
import { useQuery } from "@/hooks/useQuery";
import { colors, space } from "@/theme/tokens";

const SEARCH_DEBOUNCE_MS = 350;

// The header extras: the lifetime chips and the review-queue count. Loaded on
// their own so a slow total never delays the list.
async function loadHeaderStats() {
  const [lifetime, reviewCount] = await Promise.all([
    getLifetimeFlowTotals(),
    getReviewQueueCount().catch(() => 0),
  ]);
  return { lifetime, reviewCount };
}

// The full ledger: newest first, grouped by day, searchable, loaded a page
// at a time. Amounts here are never masked (a deliberate destination).
export default function Transactions() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TransactionFilters>(NO_FILTERS);
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(() => new Date().toISOString());
  const requestId = useRef(0);
  const { data: stats } = useQuery(loadHeaderStats);

  // Debounce typing into the applied query.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const loadFirstPage = useCallback(
    async (userInitiated: boolean) => {
      const id = ++requestId.current;
      if (userInitiated) setRefreshing(true);
      try {
        const page = await getTransactions({ q: query, filters });
        if (id !== requestId.current) return;
        setRows(page);
        setHasMore(page.length === TRANSACTIONS_PAGE_SIZE);
        setLoadedAt(new Date().toISOString());
        setError(null);
      } catch {
        if (id !== requestId.current) return;
        setError("Couldn't load transactions. Check your connection and try again.");
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [query, filters],
  );

  // Reloads on focus and whenever the applied search changes.
  useFocusEffect(
    useCallback(() => {
      loadFirstPage(false);
    }, [loadFirstPage]),
  );

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const page = await getTransactions({ q: query, filters, offset: rows.length });
      // A refresh or new search started meanwhile: this page is stale.
      if (id !== requestId.current) return;
      const seen = new Set(rows.map((row) => row.id));
      setRows([...rows, ...page.filter((row) => !seen.has(row.id))]);
      setHasMore(page.length === TRANSACTIONS_PAGE_SIZE);
    } catch {
      // Keep what is shown; the button stays for another try.
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <ListScreen edges={["left", "right"]}>
      <SectionList
        sections={groupByDay(rows, loadedAt)}
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
          <View style={{ paddingTop: space[4], gap: space[3] }}>
            <ScreenHeader
              title="Transactions"
              action={
                <Button
                  label="Add transaction"
                  variant="secondary"
                  onPress={() => router.push("/add-transaction")}
                />
              }
            />
            {stats ? (
              <>
                <View style={{ flexDirection: "row" }}>
                  <Button
                    label={stats.reviewCount > 0 ? `Review queue (${stats.reviewCount})` : "Review queue"}
                    variant="ghost"
                    onPress={() => router.push("/inbox")}
                  />
                </View>
                <LifetimeChips
                  totals={stats.lifetime}
                  accountCreatedIso={stats.lifetime.accountCreatedIso}
                />
              </>
            ) : null}
            <TextField
              label="Search"
              value={input}
              onChangeText={setInput}
              placeholder="Name, reference or category"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            <FilterChips value={filters} onChange={setFilters} />
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
            <TransactionItem transaction={item} masked={false} />
          </View>
        )}
        ListEmptyComponent={
          loading ? (
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
              title={query.trim() || activeFilterCount(filters) ? "Nothing matches that search" : "No transactions yet"}
              description={
                query.trim() || activeFilterCount(filters)
                  ? "Try a different name, reference or category, or clear the filters."
                  : "They appear here as OneLedger records them."
              }
            />
          )
        }
        ListFooterComponent={
          hasMore ? (
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
