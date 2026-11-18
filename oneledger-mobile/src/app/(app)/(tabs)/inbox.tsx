import { router } from "expo-router";
import * as Linking from "expo-linking";
import { useCallback, useState } from "react";
import { RefreshControl, SectionList, View } from "react-native";

import { fetchInbox } from "@/api/mobile-api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ListScreen,
  listContentStyle,
  ScreenHeader,
  StatTile,
  Text,
} from "@/components/ds";
import {
  actionKey,
  canPickCategory,
  fallbackNotice,
  kindLabel,
  transactionIdFromHref,
  webUrl,
} from "@/features/inbox/display";
import { groupInbox, type InboxGroup } from "@/features/inbox/grouping";
import type { InboxInlineAction, InboxItem } from "@/features/inbox/types";
import { InboxNotifications } from "@/features/notifications/InboxNotifications";
import {
  confirmCategory,
  dismissDuplicate,
  dismissSuggestion,
  mergeDuplicate,
  ReviewActionError,
} from "@/features/review/actions";
import { ReviewList } from "@/features/review/ReviewList";
import { formatDateTime } from "@/lib/kigali-time";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";
import { colors, space } from "@/theme/tokens";

function runAction(action: InboxInlineAction): Promise<void> {
  switch (action.type) {
    case "confirm_category":
      return confirmCategory(action.transactionId);
    case "dismiss_category":
      return dismissSuggestion(action.transactionId);
    case "dismiss_duplicate":
      return dismissDuplicate(action.transactionId);
    case "merge_duplicate":
      return mergeDuplicate(action.duplicateId, action.canonicalId);
  }
}

// Everything that needs a decision, in the order the web ranks it. The list
// is computed by the web app (it owns the feature flags and cross-domain
// read models); simple decisions are made here, the rest open the web.
// If the server endpoint is off, failing or unreachable the tab falls back to the
// direct category-review queue, so a category check is never out of reach.
export default function Inbox() {
  const load = useCallback(() => fetchInbox(), []);
  const { data, loading, refreshing, refresh } = useQuery(load);
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const decide = useCallback(
    async (item: InboxItem, action: InboxInlineAction) => {
      setBusy(item.id);
      setErrors((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      try {
        await runAction(action);
        setDecided((prev) => new Set(prev).add(item.id));
        refresh();
      } catch (e) {
        const message =
          e instanceof ReviewActionError ? e.message : "Couldn't save that. Try again.";
        setErrors((prev) => ({ ...prev, [item.id]: message }));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const notice = fallbackNotice(data);
  if (notice) {
    // The retry reloads the full inbox; if it now succeeds this branch ends.
    return <ReviewList notice={notice} onRetryFullInbox={refresh} />;
  }

  const items = data?.ok ? data.inbox.items.filter((i) => !decided.has(i.id)) : [];
  const critical = items.filter((i) => i.priority === "critical").length;
  const high = items.filter((i) => i.priority === "high").length;

  return (
    <ListScreen edges={["left", "right"]}>
      <SectionList
        sections={groupInbox(items)}
        keyExtractor={(entry) => (entry.type === "group" ? entry.id : entry.item.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={listContentStyle}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={{ paddingTop: space[4], gap: space[3], marginBottom: space[3] }}>
            <ScreenHeader title="Inbox" subtitle="Everything that needs a decision" inline />
            <InboxNotifications />
            {items.length > 0 ? (
              <View style={{ flexDirection: "row", gap: space[2] }}>
                <StatTile label="Open" value={String(items.length)} />
                <StatTile label="Resolve first" value={String(critical)} />
                <StatTile label="Next up" value={String(high)} />
              </View>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
        renderSectionHeader={({ section }) => (
          <Text
            variant="bodyStrong"
            accessibilityRole="header"
            style={{ marginTop: space[4], marginBottom: space[2] }}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item: entry }) =>
          entry.type === "group" ? (
            <GroupCard group={entry} />
          ) : (
            <InboxCard
              item={entry.item}
              busy={busy === entry.item.id}
              error={errors[entry.item.id] ?? null}
              onAction={(action) => decide(entry.item, action)}
            />
          )
        }
        ListEmptyComponent={
          loading ? (
            <Text variant="label" color="textMuted">
              Loading…
            </Text>
          ) : data && !data.ok ? (
            <EmptyState
              title={data.message}
              action={<Button label="Try again" variant="secondary" onPress={refresh} />}
            />
          ) : (
            <EmptyState
              variant="setup"
              title="You're all caught up"
              description="Decisions and problems across your ledger show up here."
            />
          )
        }
      />
    </ListScreen>
  );
}

function InboxCard({
  item,
  busy,
  error,
  onAction,
}: {
  item: InboxItem;
  busy: boolean;
  error: string | null;
  onAction(action: InboxInlineAction): void;
}) {
  const transactionId = transactionIdFromHref(item.href);
  const url = transactionId ? null : webUrl(config.apiBaseUrl, item.href);

  return (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
        <Badge variant={item.priority === "critical" ? "attention" : "neutral"}>
          {item.priority === "critical" ? "Resolve first" : kindLabel(item.kind)}
        </Badge>
        {item.priority === "critical" ? <Badge variant="neutral">{kindLabel(item.kind)}</Badge> : null}
        {item.affectedCount > 1 ? <Badge variant="neutral">{`${item.affectedCount} items`}</Badge> : null}
      </View>
      <Text variant="bodyStrong">{item.title}</Text>
      {item.description ? (
        <Text variant="label" color="textSecondary">
          {item.description}
        </Text>
      ) : null}
      {item.actionableSince ? (
        <Text variant="caption" color="textMuted">
          Since {formatDateTime(item.actionableSince)}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" color="attention" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {item.actions.map((action, index) => (
          <Button
            key={actionKey(action)}
            label={action.label}
            variant={index === 0 ? "primary" : "secondary"}
            loading={busy && index === 0}
            disabled={busy}
            onPress={() => onAction(action)}
          />
        ))}
        {canPickCategory(item) && transactionId ? (
          <Button
            label="Pick another"
            variant="ghost"
            disabled={busy}
            onPress={() => router.push({ pathname: "/category/[id]", params: { id: transactionId } })}
          />
        ) : null}
        {transactionId && !canPickCategory(item) ? (
          <Button
            label="Open"
            variant="secondary"
            disabled={busy}
            onPress={() => router.push({ pathname: "/transaction/[id]", params: { id: transactionId } })}
          />
        ) : null}
        {url ? (
          <Button
            label="Open on the web"
            variant={item.actions.length === 0 ? "secondary" : "ghost"}
            disabled={busy}
            onPress={() => Linking.openURL(url)}
          />
        ) : null}
      </View>
    </Card>
  );
}

/**
 * One card standing in for many same-kind items that all drill into the same
 * place (web GroupSummaryItem). Decisions are made on that page, not here.
 */
function GroupCard({ group }: { group: InboxGroup }) {
  const url = webUrl(config.apiBaseUrl, group.href);
  return (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
        <Badge variant={group.priority === "critical" ? "attention" : "neutral"}>
          {group.priority === "critical" ? "Resolve first" : kindLabel(group.kind)}
        </Badge>
        {group.priority === "critical" ? <Badge variant="neutral">{kindLabel(group.kind)}</Badge> : null}
      </View>
      <Text variant="bodyStrong">{`${kindLabel(group.kind)} (${group.count})`}</Text>
      <Text variant="label" color="textSecondary">
        {`${group.count} items need review - most recent: ${group.latestDescription}`}
      </Text>
      {group.oldestSince ? (
        <Text variant="caption" color="textMuted">
          {`Oldest waiting since ${formatDateTime(group.oldestSince)}`}
        </Text>
      ) : null}
      {url ? (
        <View style={{ flexDirection: "row" }}>
          <Button label={`Review all ${group.count}`} onPress={() => Linking.openURL(url)} />
        </View>
      ) : null}
    </Card>
  );
}
