import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import { PrivatePressable as Pressable } from "@/features/privacy/PrivatePressable";

import { fetchCategories } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, ProgressBar, Screen, ScreenHeader, Text } from "@/components/ds";
import { barFraction, countLabel, grandTotal, needsReview, shareLabel } from "@/features/categories/display";
import { useQuery } from "@/hooks/useQuery";
import { formatRwf } from "@/lib/money";
import { space } from "@/theme/tokens";

// Where your money has gone, all time, per category. The totals come from the
// web's canonical aggregation (the app only displays them); tapping a category
// opens the Transactions list filtered to it, like the web.
export default function Categories() {
  const load = useCallback(() => fetchCategories(), []);
  const { data, loading, refresh } = useQuery(load);

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <ScreenHeader title="Categories" subtitle="RWF spending, all time. Other currencies are shown separately in Insights." />
      <Button label="Categorization rules" variant="secondary" onPress={() => router.push("/categorization-rules")} />

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
      ) : data && data.categories.length === 0 ? (
        <EmptyState
          title="No spending yet"
          description="Categories appear here once transactions come in."
        />
      ) : data ? (
        <>
          {data.truncated ? (
            <Card>
              <Text variant="label" color="attention" accessibilityRole="alert">
                You have a very long history, so these totals don&apos;t include all of it.
              </Text>
            </Card>
          ) : null}
          {data.categories.map((c) => {
            const grand = grandTotal(data.categories);
            return (
              <Pressable
                key={c.category}
                accessibilityRole="button"
                accessibilityLabel={`${c.category}, ${formatRwf(c.totalRwf)}, ${countLabel(c.transactionCount)}. ${shareLabel(c.totalRwf, grand)}`}
                // navigate, not push: Transactions is a tab, and pushing it from a stacked
                // screen could stack a second copy of the tab shell.
                onPress={() => router.navigate({ pathname: "/transactions", params: { category: c.category } })}
              >
                <Card style={{ gap: space[2] }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2] }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexShrink: 1 }}>
                      <Text variant="bodyStrong">{c.category}</Text>
                      {needsReview(c.category) ? <Badge variant="attention">Needs review</Badge> : null}
                    </View>
                    <Text variant="bodyStrong" tabular>
                      {formatRwf(c.totalRwf)}
                    </Text>
                  </View>
                  <ProgressBar
                    fraction={barFraction(c.totalRwf, grand)}
                    tone={needsReview(c.category) ? "attention" : "accent"}
                    label={`${c.category} share of spending`}
                  />
                  <Text variant="caption" color="textMuted">
                    {countLabel(c.transactionCount)}
                  </Text>
                </Card>
              </Pressable>
            );
          })}
        </>
      ) : null}
    </Screen>
  );
}
