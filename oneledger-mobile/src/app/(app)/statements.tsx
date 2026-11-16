import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { fetchStatementDownload, fetchStatements } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import type { DownloadFormat, Statement } from "@/features/statements/types";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";

const money = (minor: number | null, currency: Statement["totals"][number]["currency"]) =>
  minor === null ? "—" : formatMoney(BigInt(Math.round(minor)), currency);

// Your generated statements. Totals are the stored figures from the statement
// itself (the app does no statement maths); generating, packs and schedules
// stay on the web. Downloads ask the server for a fresh five-minute link.
export default function Statements() {
  const load = useCallback(() => fetchStatements(), []);
  const { data, loading, refresh } = useQuery(load);

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <ScreenHeader
        title="Statements"
        subtitle="Records generated from your OneLedger activity. Not an official statement from your provider."
      />

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
      ) : data && !data.enabled ? (
        <EmptyState title="Statements aren't available yet." />
      ) : data && data.statements.length === 0 ? (
        <EmptyState
          variant="setup"
          title="No statements yet"
          description="Generate one on the web and it appears here."
          action={
            config.apiBaseUrl ? (
              <Button
                label="Generate on the web"
                variant="secondary"
                onPress={() => Linking.openURL(`${config.apiBaseUrl}/reports/statements/new`)}
              />
            ) : undefined
          }
        />
      ) : data ? (
        data.statements.map((s) => <StatementCard key={s.id} statement={s} />)
      ) : null}
    </Screen>
  );
}

function StatementCard({ statement: s }: { statement: Statement }) {
  const [busy, setBusy] = useState<DownloadFormat | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mixed = s.totals.length > 1;

  async function download(format: DownloadFormat) {
    setBusy(format);
    setMessage(null);
    // Always a fresh link: it lives five minutes and is opened immediately.
    const result = await fetchStatementDownload(s.id, format);
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    try {
      await Linking.openURL(result.url);
    } catch {
      setMessage("Couldn't open the download. Try again.");
    }
  }

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ gap: 2 }}>
        <Text variant="heading">{s.periodLabel}</Text>
        <Text variant="label" color="textMuted">
          {s.scopeLabel} · {s.typeLabel} · {s.transactionCount}{" "}
          {s.transactionCount === 1 ? "transaction" : "transactions"}
        </Text>
        <Text variant="caption" color="textMuted">
          {s.reference}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
        {s.status !== "ready" ? (
          <Badge variant={s.status === "failed" ? "attention" : "neutral"}>
            {s.status === "failed" ? "Couldn't be generated" : "Being prepared"}
          </Badge>
        ) : null}
        {s.isUpdatedVersion ? <Badge variant="neutral">Updated version</Badge> : null}
        {s.warningCount > 0 ? (
          <Badge variant="attention">
            {s.warningCount === 1 ? "1 coverage note" : `${s.warningCount} coverage notes`}
          </Badge>
        ) : null}
      </View>

      {s.status === "ready"
        ? s.totals.map((t) => (
            <View key={t.currency} style={{ gap: 2 }}>
              {mixed ? (
                <Text variant="label" color="textSecondary">
                  {t.currency}
                </Text>
              ) : null}
              <Text variant="label" color="textSecondary" tabular>
                Opening {money(t.openingMinor, t.currency)} · Closing {money(t.closingMinor, t.currency)}
              </Text>
              <Text variant="label" color="textSecondary" tabular>
                In {money(t.creditsMinor, t.currency)} · Out {money(t.debitsMinor, t.currency)} · Fees{" "}
                {money(t.feesMinor, t.currency)}
              </Text>
              {t.reconciles === false ? (
                <Text variant="caption" color="attention">
                  These figures don&apos;t add up to the closing balance. Check the full statement on the web.
                </Text>
              ) : null}
            </View>
          ))
        : null}

      {s.status === "ready" ? (
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <View style={{ flex: 1 }}>
            <Button
              label="PDF"
              variant="secondary"
              fullWidth
              loading={busy === "pdf"}
              disabled={busy !== null}
              onPress={() => download("pdf")}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="CSV"
              variant="secondary"
              fullWidth
              loading={busy === "csv"}
              disabled={busy !== null}
              onPress={() => download("csv")}
            />
          </View>
        </View>
      ) : null}
      {message ? (
        <Text variant="label" color="attention" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </Card>
  );
}
