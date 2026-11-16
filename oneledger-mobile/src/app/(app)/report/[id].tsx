import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { fetchReport, fetchReportDownload } from "@/api/mobile-api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Screen,
  ScreenHeader,
  StatTile,
  Text,
} from "@/components/ds";
import { barFraction, statusDisplay } from "@/features/budgets/display";
import { countLabel, inRows, shareFraction, signedPercent, toneColor, toneWord } from "@/features/reports/display";
import type { Report } from "@/features/reports/types";
import { useQuery } from "@/hooks/useQuery";
import { formatRwf, formatSignedRwf } from "@/lib/money";
import { space } from "@/theme/tokens";

const money = (minor: number) => formatRwf(Math.round(minor));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={{ gap: space[3] }}>
      <Text variant="caption" color="textMuted" accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {children}
    </Card>
  );
}

// One daily report. Every figure is from its stored snapshot and every sentence
// and date is rendered by the server with the web's own functions; this only
// displays them. The PDF is a fresh five-minute link asked for on each tap.
export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => fetchReport(id), [id]);
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
            title={data && !data.ok ? data.message : "That report couldn't be found."}
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

  return <ReportBody report={data.report} back={back} />;
}

function ReportBody({ report, back }: { report: Report; back: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // A ref, not the state above: several taps in the same instant all see the
  // old state, so only a ref reliably makes a double tap one request.
  const inFlight = useRef(false);
  const s = report.snapshot;

  async function openPdf() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    // Always a fresh link: it lives five minutes and is opened immediately.
    const result = await fetchReportDownload(report.id);
    if (!result.ok) {
      inFlight.current = false;
      setBusy(false);
      setMessage(result.message);
      return;
    }
    try {
      await Linking.openURL(result.url);
    } catch {
      setMessage("Couldn't open the PDF. Try again.");
    }
    inFlight.current = false;
    setBusy(false);
  }

  const tiles = s
    ? [
        { label: "Received", value: money(s.moneyReceivedRwf) },
        { label: "Spent", value: money(s.moneySpentRwf) },
        { label: "Fees", value: money(s.feesRwf) },
        { label: "Transactions", value: `${s.transactionCount}` },
        ...(s.largestOutflowRwf !== null ? [{ label: "Largest outflow", value: money(s.largestOutflowRwf) }] : []),
        ...(s.largestInflowRwf !== null ? [{ label: "Largest inflow", value: money(s.largestInflowRwf) }] : []),
      ]
    : [];

  return (
    <Screen>
      {back}
      <ScreenHeader title={report.dateLabel} subtitle={`Daily financial report · ${report.timezone}`} />
      <View style={{ flexDirection: "row", gap: space[2], alignItems: "center", flexWrap: "wrap" }}>
        <Badge variant={report.status === "generation_failed" || report.status === "delivery_failed" ? "attention" : "neutral"}>
          {report.statusLabel}
        </Badge>
      </View>

      {report.hasDocument ? (
        <View style={{ gap: space[2] }}>
          <Button label="Download PDF" variant="secondary" fullWidth loading={busy} onPress={openPdf} />
          {message ? (
            <Text variant="label" color="attention" accessibilityLiveRegion="polite">
              {message}
            </Text>
          ) : null}
        </View>
      ) : null}

      {report.status === "generation_failed" ? (
        <EmptyState
          title="This report could not be generated"
          description={report.errorMessage ?? "An unexpected error occurred."}
        />
      ) : null}

      {!s && report.status !== "generation_failed" ? (
        <EmptyState
          title="Report not yet available"
          description="This report hasn't been generated yet. Check back after its scheduled generation time."
        />
      ) : null}

      {s ? (
        <>
          <Card style={{ alignItems: "center", gap: space[2] }}>
            <Text variant="label" color="textMuted">
              Closing balance
            </Text>
            <Text variant="display" tabular accessibilityLabel={s.closingBalanceRwf === null ? "Closing balance not available" : undefined}>
              {s.closingBalanceRwf === null ? "—" : money(s.closingBalanceRwf)}
            </Text>
            <Text variant="label" color={s.netMovementRwf > 0 ? "moneyPositive" : "textSecondary"} tabular>
              {`${formatSignedRwf(s.netMovementRwf)} net movement`}
            </Text>
          </Card>

          <Section title="Today's activity">
            <View style={{ gap: space[3] }}>
              {inRows(tiles).map((row) => (
                <View key={row[0].label} style={{ flexDirection: "row", gap: space[3] }}>
                  {row.map((tile) => (
                    <StatTile key={tile.label} label={tile.label} value={tile.value} />
                  ))}
                  {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                </View>
              ))}
            </View>
          </Section>

          <Section title="Spending breakdown">
            {report.categories.length === 0 ? (
              <Text variant="label" color="textMuted">
                No spending recorded for this day.
              </Text>
            ) : (
              report.categories.map((c) => (
                <View key={c.category} style={{ gap: space[1] }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}>
                    <Text variant="bodyStrong">{c.category}</Text>
                    <Text variant="label" color="textSecondary" tabular>
                      {money(c.amountRwf)}
                    </Text>
                  </View>
                  <ProgressBar
                    fraction={shareFraction(c.percentOfSpending)}
                    tone={c.category === "Uncategorized" ? "attention" : "accent"}
                    label={`${c.category} share of spending`}
                  />
                  <Text variant="caption" color="textMuted">
                    {`${countLabel(c.transactionCount)} · ${Math.round(c.percentOfSpending)}%`}
                  </Text>
                </View>
              ))
            )}
          </Section>

          <Section title="Budget health">
            {report.budget === null ? (
              <Text variant="label" color="textMuted">
                No active RWF budget for this period.
              </Text>
            ) : (
              report.budget.allocations.map((a) => {
                const status = statusDisplay(a.status);
                return (
                  <View key={a.type} style={{ gap: space[1] }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2] }}>
                      <Text variant="bodyStrong">{a.label}</Text>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </View>
                    <ProgressBar
                      fraction={barFraction(a)}
                      tone={a.status === "healthy" ? "positive" : a.status === "insufficient_data" ? "accent" : "attention"}
                      label={`${a.label} budget used`}
                    />
                    <Text variant="label" color="textSecondary" tabular>
                      {`${money(a.actualMinor)} of ${money(a.targetMinor)}${
                        a.remainingMinor >= 0 ? ` · ${money(a.remainingMinor)} left` : ` · ${money(-a.remainingMinor)} over`
                      }`}
                    </Text>
                  </View>
                );
              })
            )}
          </Section>

          <Section title="Trends">
            {report.trends.length === 0 ? (
              <Text variant="label" color="textMuted">
                Not enough history yet for a trend comparison.
              </Text>
            ) : (
              report.trends.map((t) => (
                <View
                  key={t.label}
                  accessible
                  accessibilityLabel={`${t.label} ${t.valueLabel}${
                    t.changePercent === null ? "" : `, ${signedPercent(t.changePercent)} ${toneWord(t.tone, t.changePercent)}`.trimEnd()
                  }`}
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2] }}
                >
                  <Text variant="label" color="textMuted">
                    {t.label}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                    <Text variant="bodyStrong" tabular>
                      {t.valueLabel}
                    </Text>
                    {t.changePercent !== null ? (
                      <Text variant="caption" color={toneColor(t.tone)} tabular>
                        {signedPercent(t.changePercent)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </Section>

          <Section title="Watch-outs">
            {report.alerts.length === 0 ? (
              <Text variant="label" color="textMuted">
                No financial alerts detected.
              </Text>
            ) : (
              report.alerts.map((a) => (
                <Text key={a.id} variant="label" color={a.tone === "attention" ? "attention" : "textSecondary"}>
                  {a.message}
                </Text>
              ))
            )}
          </Section>

          <Section title="Outlook">
            {report.forecast ? (
              <View style={{ gap: space[1] }}>
                <Text variant="label">
                  {`At the current pace, this month's spending is projected to reach ${money(report.forecast.projectedMonthEndSpendRwf)} by month end.`}
                </Text>
                <Text variant="caption" color="textMuted">
                  {report.forecast.disclaimer}
                </Text>
              </View>
            ) : (
              <Text variant="label" color="textMuted">
                Not enough history yet for a month-end projection.
              </Text>
            )}
          </Section>

          {report.insights ? (
            <Section title="OneLedger Insights">
              <Text variant="label">{report.insights.summary}</Text>
              {report.insights.observations.map((o) => (
                <Text key={o} variant="label" color="textSecondary">
                  {`• ${o}`}
                </Text>
              ))}
              <Text variant="caption" color="textMuted">
                AI-generated interpretation of the figures above, provided for informational purposes only, not financial advice.
              </Text>
            </Section>
          ) : null}

          <Text variant="caption" color="textMuted" style={{ textAlign: "center" }}>
            {`Reporting period: ${report.dateLabel} · Generated ${report.generatedLabel ?? "—"}`}
          </Text>
        </>
      ) : null}
    </Screen>
  );
}
