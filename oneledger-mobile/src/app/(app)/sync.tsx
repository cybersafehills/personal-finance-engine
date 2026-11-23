import { useCallback, useState } from "react";
import { View } from "react-native";

import { Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { captureSupported, getCaptureHealth } from "@/features/capture/capture";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { formatRwf } from "@/lib/money";
import { discardRejected, listOutboxEntries, resolveConflict, type OutboxEntry } from "@/offline/outbox";
import { useOffline } from "@/offline/offline-context";
import { getOfflineRuntime } from "@/offline/runtime";
import { explainError } from "@/offline/status";
import { space } from "@/theme/tokens";

// Sync details: what is waiting, what is held, when it last synced, and the
// safe actions (retry; discard a refused entry). Messages are plain language and
// never include request contents.
export default function SyncDetails() {
  const { status, summary, lastSyncedAt, syncNow, retryHeldOps, available } = useOffline();
  const [busy, setBusy] = useState(false);
  // `summary` is a dependency so the list reloads whenever the counts change.
  const load = useCallback(async (): Promise<OutboxEntry[]> => {
    const db = getOfflineRuntime()?.db;
    return db && summary ? listOutboxEntries(db) : [];
  }, [summary]);
  const { data, refresh } = useQuery(load);
  const entries = data ?? [];
  // Money messages caught on this phone have their own native queue (content never
  // leaves native code); only counts are shown here.
  const loadCapture = useCallback(() => (captureSupported ? getCaptureHealth() : Promise.resolve(null)), []);
  const { data: capture } = useQuery(loadCapture);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function discard(opId: string) {
    const db = getOfflineRuntime()?.db;
    if (db) await run(async () => void (await discardRejected(db, opId)));
  }

  async function resolve(opId: string, choice: "keep_mine" | "use_server") {
    const db = getOfflineRuntime()?.db;
    if (!db) return;
    await run(async () => {
      await resolveConflict(db, opId, choice);
      if (choice === "keep_mine") await syncNow();
    });
  }

  return (
    <Screen>
      <ScreenHeader title="Sync" subtitle={status.label} />
      <Card style={{ gap: space[1] }}>
        <Text variant="body">{status.detail}</Text>
        <Text variant="caption" color="textMuted">
          {lastSyncedAt ? `Last synced ${formatDateTime(lastSyncedAt)}` : "Not synced on this device yet"}
        </Text>
        <Text variant="caption" color="textMuted">
          {`${summary.pending + summary.retrying + summary.inFlight} waiting · ${summary.needsAttention} need attention`}
        </Text>
      </Card>

      {available ? (
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <Button label="Sync now" loading={busy} onPress={() => run(syncNow)} />
          {summary.needsAttention > 0 ? (
            <Button label="Retry held changes" variant="secondary" loading={busy} onPress={() => run(retryHeldOps)} />
          ) : null}
        </View>
      ) : null}

      {capture && capture.paired ? (
        <Card style={{ gap: space[1] }}>
          <Text variant="bodyStrong">Money messages from this phone</Text>
          <Text variant="label" color={capture.deadCount > 0 ? "attention" : "textSecondary"}>
            {capture.deadCount > 0
              ? `${capture.deadCount} couldn't be sent after several tries. ${capture.detail}`
              : capture.pendingCount > 0
                ? `${capture.pendingCount} saved on this phone, sending when you're online. They appear in your list once OneLedger has recorded them.`
                : "All caught up."}
          </Text>
        </Card>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState title="Nothing waiting" description="Changes you make appear here until they've reached OneLedger." />
      ) : (
        entries.map((e) =>
          e.conflict ? (
            <Card key={e.opId} style={{ gap: space[1] }}>
              <Text variant="bodyStrong">{`Category for ${e.counterparty ?? "a transaction"}`}</Text>
              <Text variant="label" color="attention">
                It was changed somewhere else while you were offline. Nothing was overwritten. Which do you want?
              </Text>
              <Text variant="label">{`Yours: ${e.conflict.mine.category}`}</Text>
              <Text variant="label">{`On OneLedger: ${e.conflict.server.category ?? "Uncategorized"}`}</Text>
              <View style={{ flexDirection: "row", gap: space[2] }}>
                <Button label="Keep mine" loading={busy} onPress={() => resolve(e.opId, "keep_mine")} />
                <Button label="Use OneLedger's" variant="secondary" loading={busy} onPress={() => resolve(e.opId, "use_server")} />
              </View>
            </Card>
          ) : (
          <Card key={e.opId} style={{ gap: space[1] }}>
            <Text variant="bodyStrong">
              {e.opType === "set_category" ? `Category for ${e.counterparty ?? "a transaction"}` : `${e.direction === "in" ? "+" : "−"}${e.amountRwf !== null ? formatRwf(e.amountRwf) : ""}${e.counterparty ? ` · ${e.counterparty}` : ""}`}
            </Text>
            <Text variant="caption" color={e.state === "rejected" || e.state === "stalled" ? "attention" : "textMuted"}>
              {e.state === "rejected" || e.state === "stalled"
                ? explainError(e.lastError)
                : e.state === "retry"
                  ? "Will retry shortly"
                  : e.state === "in_flight"
                    ? "Sending…"
                    : "Saved on this phone, waiting to send"}
            </Text>
            {e.state === "rejected" || e.state === "stalled" ? (
              <Button label="Discard this entry" variant="ghost" onPress={() => discard(e.opId)} />
            ) : null}
          </Card>
          ),
        )
      )}
    </Screen>
  );
}
