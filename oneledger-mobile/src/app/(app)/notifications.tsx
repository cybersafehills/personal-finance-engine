import { router } from "expo-router";
import { useCallback } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

import {
  Button,
  EmptyState,
  ListScreen,
  listContentStyle,
  ScreenHeader,
  Text,
} from "@/components/ds";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/features/notifications/queries";
import { pushTarget } from "@/features/push/push-routing";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { colors, radii, space } from "@/theme/tokens";

export default function NotificationsScreen() {
  const load = useCallback(() => getNotifications(), []);
  const { data, loading, refreshing, error, refresh } = useQuery(load);
  const hasUnread = (data ?? []).some((row) => row.readAt === null);

  async function open(row: NotificationRow) {
    if (row.readAt === null) await markNotificationRead(row.id);
    const target = pushTarget({
      resourceType: row.resourceType,
      resourceId: row.resourceId,
    });
    // Anything without its own screen just gets marked read in place.
    if (target.pathname === "/notifications") refresh();
    else router.push(target);
  }

  return (
    <ListScreen>
      <FlatList
        data={data ?? []}
        keyExtractor={(row) => row.id}
        contentContainerStyle={listContentStyle}
        ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={{ paddingTop: space[4], marginBottom: space[2] }}>
            <ScreenHeader
              title="Notifications"
              action={<Button label="Back" variant="ghost" onPress={() => router.back()} />}
            />
            {hasUnread ? (
              <Button
                label="Mark all as read"
                variant="secondary"
                fullWidth
                onPress={async () => {
                  await markAllNotificationsRead();
                  refresh();
                }}
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const unread = item.readAt === null;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${unread ? "Unread. " : ""}${item.title}`}
              onPress={() => open(item)}
              style={{
                backgroundColor: colors.surface,
                borderRadius: radii.card,
                borderWidth: 1,
                borderColor: unread ? colors.accent : colors.borderSubtle,
                padding: space[4],
                gap: space[1],
              }}
            >
              <Text variant="bodyStrong">{item.title}</Text>
              {item.body ? (
                <Text variant="label" color="textSecondary">
                  {item.body}
                </Text>
              ) : null}
              <Text variant="caption" color="textMuted">
                {unread ? "New · " : ""}
                {formatDateTime(item.createdAt)}
              </Text>
            </Pressable>
          );
        }}
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
              title="Nothing yet"
              description="Budget alerts, member changes and other updates will show up here."
            />
          )
        }
      />
    </ListScreen>
  );
}
