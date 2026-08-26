import "server-only";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatRwf, formatSignedRwf } from "./format";
import { reportAlertMessage, budgetAlertMessage, allocationLabel } from "./report-alert-messages";
import type { AiCommentaryPayload, ReportPayload } from "./report-types";

// The PDF document renderer for the Daily Financial Report (Phase H).
// @react-pdf/renderer is a pure-JS PDF layout engine (its own reconciler,
// not react-dom) - no headless browser, so this runs cleanly in a Vercel
// serverless function (master prompt §26: avoid a heavyweight browser
// runtime unless proven necessary). Like emails.ts, this performs NO
// financial calculation of its own - every value here is read directly
// from an already-generated report_payload.

const TEMPLATE_VERSION = 1;

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#111111" },
  brand: { fontSize: 10, color: "#666666", marginBottom: 2 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 10, color: "#666666", marginBottom: 16 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginTop: 16,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#111111",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
  },
  rowLabel: { color: "#666666" },
  rowValueBold: { fontWeight: 700 },
  bullet: { paddingVertical: 2 },
  disclaimer: { fontSize: 8, color: "#999999", marginTop: 4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 8,
    color: "#999999",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e5e5",
    paddingTop: 6,
  },
});

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={bold ? styles.rowValueBold : undefined}>{value}</Text>
    </View>
  );
}

function ReportDocument({
  payload,
  aiCommentary,
  dateLabel,
  generatedAtLabel,
}: {
  payload: ReportPayload;
  aiCommentary: AiCommentaryPayload | null;
  dateLabel: string;
  generatedAtLabel: string;
}) {
  const { financialSnapshot: snapshot } = payload;
  const budgetAlerts = payload.budget.overallStatus === "no_active_budget" ? [] : payload.budget.alerts;

  return (
    <Document title={`OneLedger Daily Report - ${dateLabel}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>OneLedger</Text>
        <Text style={styles.title}>Daily Financial Report</Text>
        <Text style={styles.subtitle}>{dateLabel} · {payload.timezone}</Text>

        <Text style={styles.sectionTitle}>Financial position</Text>
        <Row
          label="Closing balance"
          value={snapshot.closingBalanceRwf !== null ? formatRwf(snapshot.closingBalanceRwf) : "—"}
          bold
        />
        <Row
          label="Opening balance"
          value={snapshot.openingBalanceRwf !== null ? formatRwf(snapshot.openingBalanceRwf) : "—"}
        />

        <Text style={styles.sectionTitle}>Today&apos;s activity</Text>
        <Row label="Money received" value={formatRwf(snapshot.moneyReceivedRwf)} />
        <Row label="Money spent" value={formatRwf(snapshot.moneySpentRwf)} />
        <Row label="Fees" value={formatRwf(snapshot.feesRwf)} />
        <Row label="Net movement" value={formatSignedRwf(snapshot.netMovementRwf)} bold />
        <Row label="Transactions" value={`${snapshot.transactionCount}`} />

        <Text style={styles.sectionTitle}>Spending breakdown</Text>
        {payload.categoryTotals.length === 0
          ? <Text style={styles.bullet}>No spending recorded for this day.</Text>
          : payload.categoryTotals.map((category) => (
            <Row
              key={category.category}
              label={`${category.category} (${category.transactionCount})`}
              value={`${formatRwf(category.amountRwf)} · ${Math.round(category.percentOfSpending)}%`}
            />
          ))}

        <Text style={styles.sectionTitle}>Budget health</Text>
        {payload.budget.overallStatus === "no_active_budget"
          ? <Text style={styles.bullet}>No active RWF budget for this period.</Text>
          : payload.budget.allocations.map((allocation) => (
            <Row
              key={allocation.allocationType}
              label={allocationLabel(allocation.allocationType)}
              value={`${formatRwf(allocation.actualMinor)} of ${formatRwf(allocation.targetMinor)}${
                allocation.percentConsumed !== null ? ` (${Math.round(allocation.percentConsumed)}%)` : ""
              }`}
            />
          ))}

        <Text style={styles.sectionTitle}>Trends</Text>
        {payload.trends.filter((t) => t.comparisonValue !== null).length === 0
          ? <Text style={styles.bullet}>Not enough history yet for a trend comparison.</Text>
          : payload.trends
            .filter((t) => t.comparisonValue !== null)
            .map((trend) => (
              <Row
                key={trend.metric}
                label={trend.label}
                value={`${trend.metric === "transaction_count" ? Math.round(trend.currentValue) : formatRwf(trend.currentValue)}${
                  trend.changePercent !== null
                    ? ` (${trend.changePercent > 0 ? "+" : ""}${Math.round(trend.changePercent)}%)`
                    : ""
                }`}
              />
            ))}

        <Text style={styles.sectionTitle}>Watch-outs</Text>
        {payload.alerts.length === 0 && budgetAlerts.length === 0
          ? <Text style={styles.bullet}>No financial alerts detected.</Text>
          : (
            <>
              {payload.alerts.map((alert) => (
                <Text key={alert.id} style={styles.bullet}>• {reportAlertMessage(alert)}</Text>
              ))}
              {budgetAlerts.map((alert) => (
                <Text key={alert.id} style={styles.bullet}>• {budgetAlertMessage(alert)}</Text>
              ))}
            </>
          )}

        <Text style={styles.sectionTitle}>Outlook</Text>
        {payload.forecast
          ? (
            <>
              <Text style={styles.bullet}>
                Projected month-end spending: {formatRwf(Math.round(payload.forecast.projectedMonthEndSpendRwf))}
              </Text>
              <Text style={styles.disclaimer}>{payload.forecast.disclaimer}</Text>
            </>
          )
          : <Text style={styles.bullet}>Not enough history yet for a month-end projection.</Text>}

        {aiCommentary && (
          <>
            <Text style={styles.sectionTitle}>OneLedger Insights</Text>
            <Text style={styles.bullet}>{aiCommentary.summary}</Text>
            {aiCommentary.observations.map((observation, i) => (
              <Text key={i} style={styles.bullet}>• {observation}</Text>
            ))}
            <Text style={styles.disclaimer}>
              AI-generated interpretation of the figures above, provided for informational purposes only - not
              financial advice.
            </Text>
          </>
        )}

        <Text style={styles.footer}>
          Generated {generatedAtLabel} · OneLedger Daily Financial Report · Informational only, not financial
          advice.
        </Text>
      </Page>
    </Document>
  );
}

export const REPORT_PDF_TEMPLATE_VERSION = TEMPLATE_VERSION;

export async function renderReportPdf(params: {
  payload: ReportPayload;
  aiCommentary: AiCommentaryPayload | null;
  dateLabel: string;
  generatedAtLabel: string;
}): Promise<Buffer> {
  return await renderToBuffer(
    <ReportDocument
      payload={params.payload}
      aiCommentary={params.aiCommentary}
      dateLabel={params.dateLabel}
      generatedAtLabel={params.generatedAtLabel}
    />,
  );
}
