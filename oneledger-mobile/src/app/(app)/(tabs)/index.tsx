import { router } from "expo-router";
import { useCallback, useState } from "react";
import { SelectedWallet } from "@/features/wallets/SelectedWallet";
import { useOffline } from "@/offline/offline-context";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Card, EmptyState, ListGroup, ListRow, MoneyAmount, Text } from "@/components/ds";
import { fetchBudgets } from "@/api/mobile-api";
import { captureSupported, getCaptureHealth } from "@/features/capture/capture";
import { BalanceCard } from "@/features/home/BalanceCard";
import { BudgetStatusCard } from "@/features/home/BudgetStatusCard";
import {
  getCurrentBalance,
  getReviewQueueCount,
  getTodayTotals,
  getTransactions,
} from "@/features/transactions/queries";
import { TransactionItem } from "@/features/transactions/TransactionItem";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

// Home shows the six most recent, as the web does.
const RECENT_LIMIT = 6;

async function loadHome(accountId?: string) {
  const nowIso = new Date().toISOString();
  const [balance, today, recent, reviewCount, health] = await Promise.all([
    accountId ? Promise.resolve(null) : getCurrentBalance(),
    getTodayTotals(nowIso, accountId),
    getTransactions({ limit: RECENT_LIMIT, accountId }),
    getReviewQueueCount().catch(() => null),
    getCaptureHealth().catch(() => null),
  ]);
  return { balance, today, recent, reviewCount, health, nowIso };
}

// Same order as the web's Home on a phone: balance, today's totals, budget
// status, then recent transactions. Mobile shows recording setup and review
// actions below the budget when they are needed.
export default function Home() {
  const styles = useStyles();
  const { colors } = useTheme();
  // `loadHome` is a module-level function, so its identity is stable.
  const [accountId, setAccountId] = useState<string | undefined>();
  const load = useCallback(() => loadHome(accountId), [accountId]);
  const { data, loading, refreshing, error, refresh } = useQuery(load, accountId ?? "all-wallets");
  const sync = useOffline();
  const reviewCount = data?.reviewCount ?? 0;
  // Server-computed, so it loads on its own: a slow or unavailable budget
  // service never delays or breaks the rest of Home.
  const loadBudgets = useCallback(() => fetchBudgets(), []);
  const { data: budgetResult } = useQuery(loadBudgets);
  const budget = budgetResult?.ok ? (budgetResult.budgets[0] ?? null) : null;

  // Recording is "not working" when the engine exists but is not healthy.
  const recordingNeedsSetup =
    captureSupported &&
    data?.health != null &&
    (data.health.state === "setup_required" ||
      data.health.state === "permission_required" ||
      data.health.state === "reauthentication_required");

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
      >
        <SelectedWallet onSelect={setAccountId} />
        {sync.lastSyncedAt ? <Text variant="caption">Saved activity last synced {sync.lastSyncedAt}. Newer changes may be missing.</Text> : null}
        {error ? (
          <EmptyState
            variant="setup"
            title={error}
            action={<Button label="Try again" variant="secondary" onPress={refresh} />}
          />
        ) : null}

        {data ? (
          <>
            {!accountId ? <BalanceCard balance={data.balance} nowIso={data.nowIso} /> : null}

            {(data.today.byCurrency?.length ? data.today.byCurrency : [{ currency: "RWF", sentMinor: data.today.spentRwf, receivedMinor: data.today.receivedRwf }]).map((flow) => <View key={flow.currency} style={styles.row}>
              <Tile label="Received today" amountRwf={flow.receivedMinor} currency={flow.currency} />
              <Tile label="Spent today" amountRwf={-flow.sentMinor} currency={flow.currency} />
            </View>)}

            {budget ? <BudgetStatusCard budget={budget} nowIso={data.nowIso} /> : null}

            {recordingNeedsSetup || reviewCount > 0 ? (
              <ListGroup>
                {recordingNeedsSetup ? (
                  <ListRow
                    icon="radio"
                    label="Automatic recording is off"
                    hint="Let OneLedger record your MoMo transactions from this phone."
                    value={
                      <Text variant="label" color="accent">
                        Set it up
                      </Text>
                    }
                    onPress={() => router.push("/connect")}
                  />
                ) : null}
                {reviewCount > 0 ? (
                  <ListRow
                    icon="check-circle"
                    label={`${reviewCount} transaction${reviewCount === 1 ? "" : "s"} to review`}
                    value={
                      <Text variant="label" color="accent">
                        Review now
                      </Text>
                    }
                    onPress={() => router.push("/inbox")}
                  />
                ) : null}
              </ListGroup>
            ) : null}

            <Card style={{ paddingHorizontal: space[1], paddingVertical: space[2] }}>
              <View style={styles.cardHeader}>
                <Text variant="caption" color="textMuted" style={styles.kicker}>
                  RECENT TRANSACTIONS
                </Text>
                <Button label="See all" variant="ghost" onPress={() => router.push("/transactions")} />
              </View>
              {data.recent.length === 0 ? (
                <EmptyState
                  title="No transactions yet"
                  description="New MoMo transactions will appear here automatically."
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

/** One of today's totals. Signed, coloured and masked like every other amount. */
function Tile({ label, amountRwf, currency }: { label: string; amountRwf: number; currency?: string }) {
  const styles = useStyles();
  return (
    <Card style={styles.tile}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <MoneyAmount amountRwf={amountRwf} currency={currency} size="lg" />
    </Card>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[3],
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  row: { flexDirection: "row", gap: space[2] },
  tile: { flex: 1, paddingVertical: space[3], gap: space[1] },
    cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: space[3],
  },
  kicker: { letterSpacing: 0.6 },
}));
