import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, View } from "react-native";

import { fetchReports } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";
import { space } from "@/theme/tokens";

// Your daily financial reports, newest first. Each is an immutable snapshot the
// server generated; dates are formatted on the server in the report's own timezone.
export default function Reports() {
  const load = useCallback(() => fetchReports(), []);
  const { data, loading, refresh } = useQuery(load);

  return (
    <Screen>
      <ScreenHeader title="Reports" subtitle="Your daily financial reports" />

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
      ) : data && data.reports.length === 0 ? (
        <EmptyState
          variant="setup"
          title="No reports yet"
          description="Turn on daily reports in Settings to start receiving a financial summary each morning."
          action={
            config.apiBaseUrl ? (
              <Button
                label="Open report settings on the web"
                variant="secondary"
                onPress={() => Linking.openURL(`${config.apiBaseUrl}/settings/reports`)}
              />
            ) : undefined
          }
        />
      ) : data ? (
        data.reports.map((report) => (
          <Pressable
            key={report.id}
            accessibilityRole="button"
            accessibilityLabel={`${report.dateLabel}, ${report.statusLabel}`}
            onPress={() => router.push({ pathname: "/report/[id]", params: { id: report.id } })}
          >
            <Card style={{ gap: space[1] }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] }}>
                <Text variant="bodyStrong">{report.dateLabel}</Text>
                <Badge variant={report.status === "generation_failed" || report.status === "delivery_failed" ? "attention" : "neutral"}>
                  {report.statusLabel}
                </Badge>
              </View>
              <Text variant="caption" color="textMuted">
                {report.generatedLabel ? `Generated ${report.generatedLabel}` : "Not yet generated"}
              </Text>
            </Card>
          </Pressable>
        ))
      ) : null}
    </Screen>
  );
}
