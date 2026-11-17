import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { fetchBills } from "@/api/mobile-api";
import { Badge, Button, Card, Chip, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

// The few statuses worth a shortcut. "" is every document.
const FILTERS: { label: string; status: string }[] = [
  { label: "All", status: "" },
  { label: "Needs review", status: "needs_review" },
  { label: "Approved", status: "approved" },
  { label: "Failed", status: "processing_failed" },
];

// The invoices and receipts in the Space you are viewing, newest first. Read-only:
// uploading and reviewing stay on the web. Statuses and dates come from the server.
export default function Bills() {
  const [status, setStatus] = useState("");
  const load = useCallback(() => fetchBills(status || undefined), [status]);
  const { data, loading, refresh } = useQuery(load);

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <ScreenHeader title="Bills" subtitle="Invoices and receipts in this Space" />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {FILTERS.map((f) => (
          <Chip key={f.label} label={f.label} selected={status === f.status} onPress={() => setStatus(f.status)} />
        ))}
      </View>

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
      ) : data && data.bills.length === 0 ? (
        <EmptyState
          variant="setup"
          title={status ? "Nothing here" : "No documents yet"}
          description={
            status
              ? "No documents have this status."
              : "Invoices and receipts uploaded on the web appear here with their status."
          }
        />
      ) : data ? (
        <>
          {data.bills.map((bill) => (
            <Pressable
              key={bill.id}
              accessibilityRole="button"
              accessibilityLabel={`${bill.filename}, ${bill.statusLabel}`}
              onPress={() => router.push({ pathname: "/bill/[id]", params: { id: bill.id } })}
            >
              <Card style={{ gap: space[1] }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] }}>
                  <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
                    {bill.filename}
                  </Text>
                  <Badge variant={bill.tone}>{bill.statusLabel}</Badge>
                </View>
                <Text variant="caption" color="textMuted">
                  {`Uploaded ${bill.uploadedLabel}`}
                  {bill.pageCount ? ` · ${bill.pageCount} page${bill.pageCount === 1 ? "" : "s"}` : ""}
                </Text>
              </Card>
            </Pressable>
          ))}
          {data.hasMore ? (
            <Text variant="caption" color="textMuted">
              Showing the newest documents. Older ones are on the web.
            </Text>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
