import * as Linking from "expo-linking";
import { useCallback } from "react";
import { FlatList, RefreshControl, View } from "react-native";

import {
  Button,
  Card,
  EmptyState,
  ListScreen,
  listContentStyle,
  ScreenHeader,
  Text,
} from "@/components/ds";
import { getReviewQueue } from "@/features/transactions/queries";
import { TransactionItem } from "@/features/transactions/TransactionItem";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";
import { colors, space } from "@/theme/tokens";

// Transactions whose category OneLedger is unsure about. Read-only for now:
// confirming a category runs through the web's server-side rules, which the
// app does not call yet, so it hands off to the web for the decision.
export default function Review() {
  const load = useCallback(() => getReviewQueue(), []);
  const { data, loading, refreshing, error, refresh } = useQuery(load);

  return (
    <ListScreen>
      <FlatList
        data={data ?? []}
        keyExtractor={(row) => row.id}
        contentContainerStyle={listContentStyle}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={{ paddingTop: space[4], gap: space[3], marginBottom: space[3] }}>
            <ScreenHeader
              title="To review"
              subtitle="Transactions that need a category check"
            />
            {data && data.length > 0 && config.apiBaseUrl ? (
              <Card style={{ gap: space[3] }}>
                <Text variant="label" color="textSecondary">
                  You can look through them here. To confirm or change a
                  category, use OneLedger on the web for now.
                </Text>
                <Button
                  label="Review on the web"
                  variant="secondary"
                  fullWidth
                  onPress={() => Linking.openURL(`${config.apiBaseUrl}/inbox`)}
                />
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ backgroundColor: colors.surface }}>
            <TransactionItem transaction={item} showDate masked={false} />
          </View>
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
