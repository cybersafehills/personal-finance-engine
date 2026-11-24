import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, View } from "react-native";

import { fetchReports } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, Screen, Text } from "@/components/ds";
import { useQuery } from "@/hooks/useQuery";
import {DocumentsHeader,DocumentHero} from "@/features/documents/DocumentUI";
import { SaveOnSavingsCard } from "@/features/save-on/SaveOnSavingsCard";
import { space } from "@/theme/tokens";

// Your daily financial reports, newest first. Each is an immutable snapshot the
// server generated; dates are formatted on the server in the report's own timezone.
export default function Reports() {
  const load = useCallback(() => fetchReports(), []);
  const { data, loading, refresh } = useQuery(load);

  return (
    <Screen>
      <DocumentsHeader tab="reports" />
      <DocumentHero title="Your money, reviewed daily" detail="Read a saved report or manage the next scheduled summary." action={data?.ok&&data.reports.length ? "Open latest report" : "Manage daily reports"} onPress={()=>data?.ok&&data.reports.length?router.push({pathname:"/report/[id]",params:{id:data.reports[0].id}}):router.push("/report-settings")} />
      {/* Save On: fees saved by sending in parts, as its own section. Absent when Save On is off. */}
      <SaveOnSavingsCard />
      <Text variant="bodyStrong">Recent reports</Text>

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
          action={<Button label="Manage daily reports" variant="secondary" onPress={()=>router.push('/report-settings')}/>}
        />
      ) : data ? (
        data.reports.map((report) => (
          <Pressable
            key={report.id}
            accessibilityRole="button"
            accessibilityLabel={`${report.dateLabel}, ${report.statusLabel}`}
            onPress={() => router.push({ pathname: "/report/[id]", params: { id: report.id } })}
          >
            <Card style={{ gap: space[1],padding:14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] }}>
                <Text variant="bodyStrong" style={{fontSize:14}}>{report.dateLabel}</Text>
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
