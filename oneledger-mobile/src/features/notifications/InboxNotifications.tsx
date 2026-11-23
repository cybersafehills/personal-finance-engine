import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button, Text } from "@/components/ds";
import { pushTarget } from "@/features/push/push-routing";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { radii, space } from "@/theme/tokens";

import { groupByTitle } from "./grouping";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "./queries";
import { makeStyles } from "@/theme/ThemeProvider";

// The most recent notifications, shown above the decisions as on the web's
// Inbox. /notifications holds the full history.
const RECENT_LIMIT = 8;

/**
 * "Notifications" block at the top of the Inbox: latest first, same-title
 * alerts folded behind "Show N earlier", mark read one or all, "View all".
 * Renders nothing when there are none (the web does the same), and a failure
 * to load never touches the decisions below.
 */
export function InboxNotifications() {
  const styles = useStyles();
  const load = useCallback(() => getNotifications(RECENT_LIMIT), []);
  const { data, refresh } = useQuery(load);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (!data || data.length === 0) return null;
  const unread = data.filter((n) => n.readAt === null).length;

  async function open(n: NotificationRow) {
    if (n.readAt === null) await markNotificationRead(n.id);
    const target = pushTarget({ resourceType: n.resourceType, resourceId: n.resourceId });
    if (target.pathname === "/notifications") refresh();
    else router.push(target);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text variant="bodyStrong">Notifications</Text>
        <Button label="View all" variant="ghost" onPress={() => router.push("/notifications")} />
      </View>
      {unread > 0 ? (
        <View style={styles.header}>
          <Text variant="caption" color="textMuted">{`${unread} unread`}</Text>
          <Button
            label="Mark all read"
            variant="ghost"
            onPress={async () => {
              await markAllNotificationsRead();
              refresh();
            }}
          />
        </View>
      ) : null}

      {groupByTitle(data).map(({ first, rest }) => (
        <View key={first.id} style={styles.group}>
          <Row n={first} onOpen={() => open(first)} onMarkRead={async () => { await markNotificationRead(first.id); refresh(); }} />
          {rest.length > 0 ? (
            expanded.has(first.id) ? (
              rest.map((n) => (
                <Row key={n.id} n={n} onOpen={() => open(n)} onMarkRead={async () => { await markNotificationRead(n.id); refresh(); }} />
              ))
            ) : (
              <Button
                label={`Show ${rest.length} earlier`}
                variant="ghost"
                onPress={() => setExpanded(new Set(expanded).add(first.id))}
              />
            )
          ) : null}
        </View>
      ))}
    </View>
  );
}

function Row({
  n,
  onOpen,
  onMarkRead,
}: {
  n: NotificationRow;
  onOpen(): void;
  onMarkRead(): void;
}) {
  const styles = useStyles();
  const unread = n.readAt === null;
  return (
    <View style={[styles.card, unread && styles.cardUnread]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${unread ? "Unread. " : ""}${n.title}`}
        onPress={onOpen}
        style={styles.body}
      >
        <Text variant="bodyStrong">{n.title}</Text>
        {n.body ? (
          <Text variant="label" color="textSecondary">
            {n.body}
          </Text>
        ) : null}
        <Text variant="caption" color="textMuted">
          {formatDateTime(n.createdAt)}
        </Text>
      </Pressable>
      {unread ? <Button label="Mark read" variant="ghost" onPress={onMarkRead} /> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  wrap: { gap: space[2] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  group: { gap: space[1] },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: space[3],
    gap: space[1],
  },
  cardUnread: { borderColor: colors.accent },
  body: { gap: space[1] },
}));
