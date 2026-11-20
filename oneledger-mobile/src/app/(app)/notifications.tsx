import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
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
import { groupByTitle, type NotificationGroup } from "@/features/notifications/grouping";
import { pushTarget } from "@/features/push/push-routing";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { radii, space } from "@/theme/tokens";
import { useTheme } from "@/theme/ThemeProvider";

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const load = useCallback(() => getNotifications(), []);
  const { data, loading, refreshing, error, refresh } = useQuery(load);
  const unreadCount = (data ?? []).filter((row) => row.readAt === null).length;
  const hasUnread = unreadCount > 0;
  const groups = useMemo(() => groupByTitle(data ?? []), [data]);

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

  async function markRead(row: NotificationRow) {
    await markNotificationRead(row.id);
    refresh();
  }

  return (
    <ListScreen>
      <FlatList
        data={groups}
        keyExtractor={(group) => group.first.id}
        contentContainerStyle={listContentStyle}
        ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={{ paddingTop: space[4], marginBottom: space[2] }}>
            <ScreenHeader
              title="Notifications"
            />
            {hasUnread ? (
              <Text variant="label" color="textMuted" style={{ marginBottom: space[2] }}>
                {unreadCount} unread
              </Text>
            ) : null}
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
        renderItem={({ item }) => (
          <GroupItem group={item} onOpen={open} onMarkRead={markRead} />
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
              title="Nothing yet"
              description="Budget alerts, member changes and other updates will show up here."
            />
          )
        }
      />
    </ListScreen>
  );
}

function GroupItem({
  group,
  onOpen,
  onMarkRead,
}: {
  group: NotificationGroup;
  onOpen: (row: NotificationRow) => void;
  onMarkRead: (row: NotificationRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const unreadRest = group.rest.filter((row) => row.readAt === null).length;
  return (
    <View style={{ gap: space[2] }}>
      <Row row={group.first} onOpen={onOpen} onMarkRead={onMarkRead} />
      {group.rest.length > 0 && !expanded ? (
        <Button
          label={`Show ${group.rest.length} earlier${unreadRest > 0 ? ` (${unreadRest} unread)` : ""}`}
          variant="ghost"
          onPress={() => setExpanded(true)}
        />
      ) : null}
      {expanded
        ? group.rest.map((row) => (
            <Row key={row.id} row={row} onOpen={onOpen} onMarkRead={onMarkRead} />
          ))
        : null}
    </View>
  );
}

function Row({
  row,
  onOpen,
  onMarkRead,
}: {
  row: NotificationRow;
  onOpen: (row: NotificationRow) => void;
  onMarkRead: (row: NotificationRow) => void;
}) {
  const { colors } = useTheme();
  const unread = row.readAt === null;
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radii.card,
        borderWidth: 1,
        borderColor: unread ? colors.accent : colors.borderSubtle,
        padding: space[4],
        gap: space[1],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${unread ? "Unread. " : ""}${row.title}`}
        onPress={() => onOpen(row)}
        style={{ gap: space[1] }}
      >
        <Text variant="bodyStrong">{row.title}</Text>
        {row.body ? (
          <Text variant="label" color="textSecondary">
            {row.body}
          </Text>
        ) : null}
        <Text variant="caption" color="textMuted">
          {unread ? "New · " : ""}
          {formatDateTime(row.createdAt)}
        </Text>
      </Pressable>
      {unread ? (
        <Button
          label="Mark read"
          variant="ghost"
          accessibilityLabel={`Mark read: ${row.title}`}
          onPress={() => onMarkRead(row)}
        />
      ) : null}
    </View>
  );
}
