import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  MoneyAmount,
  ScreenHeader,
  StatTile,
  Text,
} from "@/components/ds";
import { captureSupported, getCaptureHealth } from "@/features/capture/capture";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import {
  getCurrentBalance,
  getReviewQueueCount,
  getTodayTotals,
  getTransactions,
} from "@/features/transactions/queries";
import { TransactionItem } from "@/features/transactions/TransactionItem";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { formatRwf } from "@/lib/money";
import { colors, space } from "@/theme/tokens";

async function loadHome() {
  const nowIso = new Date().toISOString();
  const [balance, today, recent, reviewCount, health] = await Promise.all([
    getCurrentBalance(),
    getTodayTotals(nowIso),
    getTransactions({ limit: 8 }),
    getReviewQueueCount(),
    getCaptureHealth(),
  ]);
  return { balance, today, recent, reviewCount, health };
}

export default function Home() {
  const { amountsHidden, toggleAmountsHidden } = usePrivacy();
  // `loadHome` is a module-level function, so its identity is stable.
  const { data, loading, refreshing, error, refresh } = useQuery(loadHome);

  // Recording is "not working" when the engine exists but is not healthy.
  const recordingNeedsSetup =
    captureSupported &&
    data?.health != null &&
    (data.health.state === "setup_required" ||
      data.health.state === "permission_required" ||
      data.health.state === "reauthentication_required");

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
      >
        <ScreenHeader
          title="Home"
          action={
            <Button
              label={amountsHidden ? "Show amounts" : "Hide amounts"}
              variant="ghost"
              onPress={toggleAmountsHidden}
            />
          }
        />

        {error && !data ? (
          <EmptyState
            variant="setup"
            title={error}
            action={<Button label="Try again" variant="secondary" onPress={refresh} />}
          />
        ) : null}

        {data ? (
          <>
            <Card>
              <Text variant="caption" color="textMuted">
                MoMo balance
              </Text>
              {data.balance ? (
                <>
                  <MoneyBalance amountRwf={data.balance.amountRwf} hidden={amountsHidden} />
                  <Text variant="caption" color="textMuted">
                    As of {formatDateTime(data.balance.asOfIso)}, from your last
                    MoMo message
                  </Text>
                </>
              ) : (
                <Text variant="label" color="textSecondary" style={{ marginTop: space[1] }}>
                  No balance yet. It appears after your first recorded MoMo
                  message.
                </Text>
              )}
            </Card>

            <View style={styles.row}>
              <StatTile
                label="In today"
                value={amountsHidden ? "••••••" : formatRwf(data.today.receivedRwf)}
              />
              <StatTile
                label="Out today"
                value={amountsHidden ? "••••••" : formatRwf(data.today.spentRwf)}
              />
            </View>

            {recordingNeedsSetup ? (
              <Card style={styles.stack}>
                <Badge variant="attention">Automatic recording is off</Badge>
                <Text variant="label" color="textSecondary">
                  Let OneLedger record your MoMo transactions from this phone,
                  so you don&apos;t have to type them in.
                </Text>
                <Button label="Set it up" fullWidth onPress={() => router.push("/connect")} />
              </Card>
            ) : null}

            {data.reviewCount > 0 ? (
              <Card style={styles.stack}>
                <Text variant="bodyStrong">
                  {data.reviewCount} transaction{data.reviewCount === 1 ? "" : "s"} to review
                </Text>
                <Button
                  label="Review now"
                  variant="secondary"
                  fullWidth
                  onPress={() => router.push("/review")}
                />
              </Card>
            ) : null}

            <Card style={{ paddingHorizontal: space[1], paddingVertical: space[2] }}>
              <View style={styles.cardHeader}>
                <Text variant="label" color="textSecondary">
                  Recent activity
                </Text>
                <Button label="See all" variant="ghost" onPress={() => router.push("/transactions")} />
              </View>
              {data.recent.length === 0 ? (
                <EmptyState
                  title="No transactions yet"
                  description="They appear here as OneLedger records them."
                />
              ) : (
                data.recent.map((transaction) => (
                  <TransactionItem key={transaction.id} transaction={transaction} showDate />
                ))
              )}
            </Card>
          </>
        ) : loading ? (
          <Text variant="label" color="textMuted">
            Loading…
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The balance is a level, not a movement, so it carries no +/− sign. */
function MoneyBalance({ amountRwf, hidden }: { amountRwf: number; hidden: boolean }) {
  if (hidden) return <MoneyAmount amountRwf={0} size="xl" masked />;
  return (
    <Text variant="display" tabular>
      {formatRwf(amountRwf)}
    </Text>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: space[4],
    gap: space[4],
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  row: { flexDirection: "row", gap: space[3] },
  stack: { gap: space[3] },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: space[3],
  },
});
