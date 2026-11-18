import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { fetchBill, fetchBillOriginal } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import type { BillDetail } from "@/features/bills/types";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

// One invoice or receipt. Read-only: fields, checks and history are rendered by
// the server; the original file and every edit stay on the web. Extracted values
// are the document's claims, not verified data.
export default function BillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => fetchBill(id), [id]);
  const { data, loading, refresh } = useQuery(load);

  const back = <Button label="Back" variant="ghost" onPress={() => router.back()} />;

  if (!data || !data.ok) {
    return (
      <Screen>
        {back}
        {loading && !data ? (
          <Text variant="label" color="textMuted">
            Loading…
          </Text>
        ) : (
          <EmptyState
            title={data && !data.ok ? data.message : "That document wasn't found."}
            action={
              data && !data.ok && (data.reason === "not_found" || data.reason === "unavailable") ? undefined : (
                <Button label="Try again" variant="secondary" onPress={refresh} />
              )
            }
          />
        )}
      </Screen>
    );
  }
  return <BillBody bill={data.bill} back={back} />;
}

function BillBody({ bill, back }: { bill: BillDetail; back: React.ReactElement }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // A ref, not state: several taps in one instant all see the old state, and each
  // ask is audited on the server, so a double tap must be one request.
  const inFlight = useRef(false);

  async function openOriginal() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      // Always a fresh link, opened at once; never stored or logged.
      const result = await fetchBillOriginal(bill.id);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      try {
        await Linking.openURL(result.url);
      } catch {
        setMessage("Couldn't open the original. Try again.");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen>
      {back}
      <ScreenHeader title={bill.filename} subtitle="Extracted details are the document's claims, not verified data." />
      <View style={{ flexDirection: "row" }}>
        <Badge variant={bill.tone}>{bill.statusLabel}</Badge>
      </View>

      <Card style={{ gap: space[1] }}>
        <Text variant="bodyStrong">Document</Text>
        <Text variant="label" color="textSecondary">
          {`${bill.typeLabel} · ${bill.sizeLabel}${bill.pageCount ? ` · ${bill.pageCount} page${bill.pageCount === 1 ? "" : "s"}` : ""}`}
        </Text>
        <Text variant="caption" color="textMuted">{`Uploaded ${bill.uploadedLabel}`}</Text>
        {bill.canViewOriginal ? (
          <Button label="View original" variant="secondary" fullWidth loading={busy} onPress={openOriginal} />
        ) : (
          <Text variant="caption" color="textMuted">
            You don&apos;t have permission to open the original.
          </Text>
        )}
        {message ? (
          <Text variant="label" color="attention" accessibilityRole="alert">
            {message}
          </Text>
        ) : null}
      </Card>

      {bill.extraction === null ? (
        <Card>
          <Text variant="label" color="textSecondary">
            Automated extraction isn&apos;t on for this Space. The original is stored on the web.
          </Text>
        </Card>
      ) : (
        <>
          <Card style={{ gap: space[2] }}>
            <Text variant="bodyStrong">Fields</Text>
            {bill.extraction.fields.length === 0 ? (
              <Text variant="label" color="textMuted">Nothing has been extracted yet.</Text>
            ) : (
              bill.extraction.fields.map((f, i) => (
                <View key={`${f.key}-${i}`} accessible accessibilityLabel={`${f.label}: ${f.value}`}>
                  <Text variant="caption" color="textMuted">{f.label}</Text>
                  <Text variant="body">{f.value}</Text>
                </View>
              ))
            )}
          </Card>

          {bill.extraction.lineItems.length > 0 ? (
            <Card style={{ gap: space[2] }}>
              <Text variant="bodyStrong">Line items</Text>
              {bill.extraction.lineItems.map((li, i) => (
                <View
                  key={i}
                  accessible
                  accessibilityLabel={`${li.description}${li.quantityLabel ? `, quantity ${li.quantityLabel}` : ""}, ${li.totalLabel}`}
                  style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}
                >
                  <Text variant="body" style={{ flexShrink: 1 }}>
                    {li.quantityLabel ? `${li.quantityLabel} × ${li.description}` : li.description}
                  </Text>
                  <Text variant="bodyStrong">{li.totalLabel}</Text>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      )}

      {bill.checks ? (
        <Card style={{ gap: space[2] }}>
          <Text variant="bodyStrong">Checks</Text>
          {bill.checks.outOfDate ? (
            <Text variant="label" color="attention">
              A field was corrected after these checks ran. Re-check on the web.
            </Text>
          ) : null}
          {bill.checks.findings.length === 0 ? (
            <Text variant="label" color="textMuted">No issues found.</Text>
          ) : (
            bill.checks.findings.map((f) => (
              <View key={f.id} accessible accessibilityLabel={`${f.severityLabel}: ${f.title}. ${f.detail}`} style={{ gap: space[1] }}>
                <Badge variant={f.severity === "blocking" ? "attention" : "neutral"}>{f.severityLabel}</Badge>
                <Text variant="bodyStrong">{f.title}</Text>
                <Text variant="label" color="textSecondary">{f.detail}</Text>
                {f.suggestedAction ? <Text variant="caption" color="textMuted">{f.suggestedAction}</Text> : null}
              </View>
            ))
          )}
        </Card>
      ) : null}

      <Card style={{ gap: space[2] }}>
        <Text variant="bodyStrong">Processing history</Text>
        {bill.history === null ? (
          <Text variant="label" color="textMuted">
            You don&apos;t have permission to see this document&apos;s processing history.
          </Text>
        ) : bill.history.length === 0 ? (
          <Text variant="label" color="textMuted">No processing history is visible to you.</Text>
        ) : (
          bill.history.map((e) => (
            <View key={e.id} accessible accessibilityLabel={`${e.label}. ${e.byLabel}, ${e.whenLabel}`}>
              <Text variant="body">{e.label}</Text>
              <Text variant="caption" color="textMuted">{`${e.byLabel} · ${e.whenLabel}`}</Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}
