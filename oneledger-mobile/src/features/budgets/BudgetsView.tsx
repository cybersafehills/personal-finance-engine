import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { fetchBudgets } from "@/api/mobile-api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Screen,
  ScreenHeader,
  Text,
  type ProgressTone,
} from "@/components/ds";
import {
  barFraction,
  paceLabel,
  periodLabel,
  statusDisplay,
  totals,
  worstStatus,
} from "@/features/budgets/display";
import type { Budget, BudgetAllocation } from "@/features/budgets/types";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";

const money = (minor: number, currency: Budget["currency"]) =>
  formatMoney(BigInt(Math.round(minor)), currency);

const tone = (status: BudgetAllocation["status"]): ProgressTone =>
  status === "healthy" ? "positive" : status === "insufficient_data" ? "accent" : "attention";

// Your active budget, with how each part of it is going. The figures come
// from the web's budget maths (the app only displays them); creating or
// editing a budget stays on the web.
export function BudgetsView({ embedded = false }: { embedded?: boolean }) {
  const load = useCallback(() => fetchBudgets(), []);
  const { data, loading, refresh } = useQuery(load);

  return (
    <Screen edges={embedded ? ["left", "right"] : undefined}>
      {embedded ? null : (
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      )}
      <ScreenHeader title={embedded ? "Plan" : "Budget"} subtitle="How this period is going" />

      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : data && !data.ok ? (
        <EmptyState
          title={data.message}
          action={
            data.reason === "unavailable" ? undefined : (
              <Button label="Try again" variant="secondary" onPress={refresh} />
            )
          }
        />
      ) : data && data.budgets.length === 0 ? (
        <EmptyState
          variant="setup"
          title="No active budget"
          description="Set one up on the web and its progress shows here."
          action={
            config.apiBaseUrl ? (
              <Button
                label="Create a budget on the web"
                variant="secondary"
                onPress={() => Linking.openURL(`${config.apiBaseUrl}/budgets/new`)}
              />
            ) : undefined
          }
        />
      ) : data ? (
        data.budgets.map((budget) => <BudgetCard key={budget.id} budget={budget} />)
      ) : null}
    </Screen>
  );
}

function BudgetCard({ budget }: { budget: Budget }) {
  const sum = totals(budget.allocations);
  const worst = statusDisplay(worstStatus(budget.allocations));
  const pace = paceLabel(budget.elapsedFraction);

  return (
    <>
      <Card style={{ gap: space[3] }}>
        <View style={{ gap: 2 }}>
          <Text variant="heading">{budget.name}</Text>
          <Text variant="label" color="textMuted">
            {periodLabel(budget.periodStart, budget.periodEnd)}
            {pace ? ` · ${pace}` : ""}
          </Text>
        </View>
        <View style={{ flexDirection: "row" }}>
          <Badge variant={worst.variant}>{worst.label}</Badge>
        </View>
        <Text variant="title" tabular>
          {money(sum.actualMinor, budget.currency)}
          <Text variant="label" color="textMuted">{` of ${money(sum.targetMinor, budget.currency)}`}</Text>
        </Text>
        <ProgressBar
          fraction={sum.percentUsed === null ? 0 : sum.percentUsed / 100}
          tone={worst.variant === "attention" ? "attention" : "accent"}
          label={`${budget.name} budget used`}
        />
        <Text variant="label" color="textSecondary" tabular>
          {sum.remainingMinor >= 0
            ? `${money(sum.remainingMinor, budget.currency)} left`
            : `${money(-sum.remainingMinor, budget.currency)} over`}
        </Text>
      </Card>

      {budget.alerts.length > 0 ? (
        <Card style={{ gap: space[2] }}>
          <Text variant="label" color="textSecondary">
            Worth a look
          </Text>
          {budget.alerts.map((alert) => (
            <Text
              key={alert.id}
              variant="label"
              color={alert.severity === "info" ? "textSecondary" : "attention"}
            >
              {alert.message}
            </Text>
          ))}
          {budget.uncategorizedCount > 0 ? (
            <Button
              label="Categorise transactions"
              variant="secondary"
              onPress={() => router.push("/transactions")}
            />
          ) : null}
        </Card>
      ) : null}

      {budget.allocations.map((a) => {
        const status = statusDisplay(a.status);
        return (
          <Card key={a.type} style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text variant="bodyStrong">{a.label}</Text>
              <Badge variant={status.variant}>{status.label}</Badge>
            </View>
            <ProgressBar
              fraction={barFraction(a)}
              tone={tone(a.status)}
              label={`${a.label} budget used`}
            />
            <Text variant="label" color="textSecondary" tabular>
              {money(a.actualMinor, budget.currency)} of {money(a.targetMinor, budget.currency)}
              {a.remainingMinor >= 0
                ? ` · ${money(a.remainingMinor, budget.currency)} left`
                : ` · ${money(-a.remainingMinor, budget.currency)} over`}
            </Text>
            {a.projectedMinor !== null ? (
              <Text variant="caption" color="textMuted" tabular>
                On this pace you&apos;ll reach about {money(a.projectedMinor, budget.currency)}.
              </Text>
            ) : null}
          </Card>
        );
      })}
    </>
  );
}
