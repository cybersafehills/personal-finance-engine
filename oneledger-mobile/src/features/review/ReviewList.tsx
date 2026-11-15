import { useCallback, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";

import {
  Button,
  EmptyState,
  ListScreen,
  listContentStyle,
  ScreenHeader,
  Text,
} from "@/components/ds";
import { confirmCategory, dismissSuggestion, ReviewActionError } from "@/features/review/actions";
import { ReviewCard } from "@/features/review/ReviewCard";
import { getReviewQueue } from "@/features/transactions/queries";
import { useQuery } from "@/hooks/useQuery";
import { colors, space } from "@/theme/tokens";

// Direct (no server round-trip) review queue: transactions whose category OneLedger is unsure about. Each one can be
// accepted or rejected right here (the same database functions the web calls).
// A decided row leaves the list immediately; if saving fails it stays, with
// the reason, so a decision is never silently lost.
export function ReviewList({ notice }: { notice?: string }) {
  const load = useCallback(() => getReviewQueue(), []);
  const { data, loading, refreshing, error, refresh } = useQuery(load);
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const decide = useCallback(
    async (id: string, action: (id: string) => Promise<void>) => {
      setBusyId(id);
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        await action(id);
        setDecided((prev) => new Set(prev).add(id));
        refresh();
      } catch (e) {
        const message =
          e instanceof ReviewActionError ? e.message : "Couldn't save that. Try again.";
        setRowErrors((prev) => ({ ...prev, [id]: message }));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const rows = (data ?? []).filter((row) => !decided.has(row.id));

  return (
    <ListScreen>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={listContentStyle}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={{ paddingTop: space[4], gap: space[3], marginBottom: space[3] }}>
            <ScreenHeader
              title="Inbox"
              subtitle={notice ?? "Transactions that need a category check"}
            />
          </View>
        }
        renderItem={({ item }) => (
          <ReviewCard
            transaction={item}
            busy={busyId === item.id}
            error={rowErrors[item.id] ?? null}
            onConfirm={() => decide(item.id, confirmCategory)}
            onDismiss={() => decide(item.id, dismissSuggestion)}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <Text variant="label" color="textMuted">
              Loading…
            </Text>
          ) : error ? (
            <EmptyState
              title={error}
              action={<Button label="Try again" variant="secondary" onPress={refresh} />}
            />
          ) : (
            <EmptyState
              variant="setup"
              title="Nothing to review"
              description="When OneLedger is unsure how to categorise a transaction, it shows up here."
            />
          )
        }
      />
    </ListScreen>
  );
}
