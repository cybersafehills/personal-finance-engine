import "server-only";
import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  formatStatementAmount,
  formatStatementSignedAmount,
  type StatementDocData,
  type StatementDocLine,
  statementDateKey,
} from "./statement-document";

// The OneLedger statement PDF (Financial Documents Engine, PR4). A new
// document family - deliberately NOT the daily-report template
// (report-pdf.tsx). Like that renderer it performs NO financial
// calculation: every figure comes straight from the StatementDocData the
// download route assembled from the persisted snapshot.
//
// @react-pdf/renderer is a pure-JS layout engine (no headless browser),
// so this runs in an ordinary Node serverless function. Transaction text
// is rendered as <Text> nodes - there is no template string evaluation,
// so an adversarial counterparty name / reference cannot inject anything;
// it can only ever be text (master prompt section 44).

const TEMPLATE_VERSION = 1;

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 54,
    paddingHorizontal: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111111",
  },
  runningHeader: {
    position: "absolute",
    top: 16,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#999999",
  },
  brand: { fontSize: 10, color: "#555555", marginBottom: 2 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#666666", marginBottom: 14 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    marginTop: 14,
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoRow: { flexDirection: "row", paddingVertical: 1.5 },
  infoLabel: { width: 130, color: "#666666" },
  infoValue: { flex: 1 },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
  },
  summaryLabel: { color: "#666666" },
  summaryValueBold: { fontWeight: 700 },
  note: { fontSize: 8, color: "#8a6d00", marginTop: 4 },
  coverageNote: { fontSize: 8, color: "#666666", marginTop: 2 },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#111111",
    paddingVertical: 3,
    marginTop: 6,
    fontSize: 8,
    fontWeight: 700,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ececec",
    paddingVertical: 2.5,
    fontSize: 8,
  },
  cellDate: { width: 58 },
  cellDesc: { flex: 1, paddingRight: 4 },
  cellRef: { width: 76, color: "#555555" },
  cellCat: { width: 58, color: "#555555" },
  cellNum: { width: 62, textAlign: "right" },
  cellCur: { width: 34, textAlign: "right", color: "#555555" },
  original: { fontSize: 7, color: "#888888" },
  disclaimer: {
    fontSize: 7.5,
    color: "#777777",
    marginTop: 16,
    lineHeight: 1.4,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#999999",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e5e5",
    paddingTop: 5,
  },
});

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Summary(
  { label, value, bold = false }: {
    label: string;
    value: string;
    bold?: boolean;
  },
) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={bold ? styles.summaryValueBold : undefined}>{value}</Text>
    </View>
  );
}

function amount(minor: number | null, currency: string): string {
  return minor === null ? "—" : formatStatementAmount(minor, currency);
}

function TableHeader({ mixed }: { mixed: boolean }) {
  return (
    <View style={styles.tableHeaderRow} fixed>
      <Text style={styles.cellDate}>Date</Text>
      <Text style={styles.cellDesc}>Description</Text>
      <Text style={styles.cellRef}>Reference</Text>
      <Text style={styles.cellNum}>Money In</Text>
      <Text style={styles.cellNum}>Money Out</Text>
      <Text style={styles.cellNum}>Balance</Text>
      {mixed ? <Text style={styles.cellCur}>Cur.</Text> : null}
    </View>
  );
}

function TxnRow(
  { line, data, mixed }: {
    line: StatementDocLine;
    data: StatementDocData;
    mixed: boolean;
  },
) {
  const inValue = line.direction === "in"
    ? formatStatementAmount(line.principalEffectMinor, data.currency)
    : "";
  const outValue = line.direction === "out"
    ? formatStatementAmount(line.principalEffectMinor, data.currency)
    : "";
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.cellDate}>
        {statementDateKey(line.occurredAt, data.timezone)}
      </Text>
      <View style={styles.cellDesc}>
        <Text>{line.displayDescription}</Text>
        {line.originalDescription
          ? <Text style={styles.original}>{line.originalDescription}</Text>
          : null}
        {data.statementType === "detailed" && line.category
          ? <Text style={styles.original}>{line.category}</Text>
          : null}
      </View>
      <Text style={styles.cellRef}>{line.reference ?? ""}</Text>
      <Text style={styles.cellNum}>{inValue}</Text>
      <Text style={styles.cellNum}>{outValue}</Text>
      <Text style={styles.cellNum}>
        {line.runningBalanceMinor === null
          ? "—"
          : formatStatementAmount(line.runningBalanceMinor, data.currency)}
      </Text>
      {mixed ? <Text style={styles.cellCur}>{data.currency}</Text> : null}
    </View>
  );
}

function StatementDocument({ data }: { data: StatementDocData }) {
  const mixed = !!data.perCurrency && data.perCurrency.length > 1;
  const generatedLabel = new Date(data.generatedAtIso).toISOString().slice(0, 16)
    .replace("T", " ") + " UTC";
  const scopeLabel = data.scope === "filtered"
    ? "Filtered statement"
    : data.scope === "all_accounts"
    ? "Consolidated statement"
    : "Account statement";

  return (
    <Document
      title={`OneLedger Statement ${data.statementId}`}
      author="OneLedger"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.runningHeader} fixed>
          <Text>OneLedger</Text>
          <Text>Statement {data.statementId}</Text>
        </View>

        <Text style={styles.brand}>OneLedger</Text>
        <Text style={styles.title}>{scopeLabel}</Text>
        <Text style={styles.subtitle}>
          {data.periodLabel}
          {data.coverage.filtered && data.coverage.filterSummary
            ? ` · ${data.coverage.filterSummary}`
            : ""}
        </Text>

        <Text style={styles.sectionTitle}>Account information</Text>
        <Info label="Account holder" value={data.accountHolderName ?? "—"} />
        <Info label="Data source" value={data.source.summaryLabel} />
        {data.source.sources.map((s) => (
          <Info
            key={s.id}
            label="Account"
            value={s.maskedIdentifier
              ? `${s.displayName} · ${s.maskedIdentifier}`
              : s.displayName}
          />
        ))}
        <Info label="Currency" value={mixed ? "Multiple" : data.currency} />
        <Info label="Statement period" value={data.periodLabel} />
        <Info label="Coverage" value={data.coverage.statementLabel} />
        {data.coverage.warnings.map((w, i) => (
          <Text key={i} style={styles.coverageNote}>• {w.detail}</Text>
        ))}

        <Text style={styles.sectionTitle}>Financial summary</Text>
        {mixed && data.perCurrency
          ? data.perCurrency.map((c) => (
            <View key={c.currency} wrap={false}>
              <Summary
                label={`${c.currency} — opening balance`}
                value={amount(c.openingBalanceMinor, c.currency)}
              />
              <Summary
                label={`${c.currency} — money in`}
                value={formatStatementAmount(c.totalCreditsMinor, c.currency)}
              />
              <Summary
                label={`${c.currency} — money out`}
                value={formatStatementAmount(c.totalDebitsMinor, c.currency)}
              />
              <Summary
                label={`${c.currency} — fees`}
                value={formatStatementAmount(c.totalFeesMinor, c.currency)}
              />
              <Summary
                label={`${c.currency} — closing balance`}
                value={amount(c.closingBalanceMinor, c.currency)}
                bold
              />
            </View>
          ))
          : (
            <>
              <Summary
                label="Opening balance"
                value={amount(data.openingBalanceMinor, data.currency)}
              />
              <Summary
                label="Money in"
                value={formatStatementAmount(data.totalCreditsMinor, data.currency)}
              />
              <Summary
                label="Money out"
                value={formatStatementAmount(data.totalDebitsMinor, data.currency)}
              />
              <Summary
                label="Fees / charges"
                value={formatStatementAmount(data.totalFeesMinor, data.currency)}
              />
              <Summary
                label="Net movement"
                value={formatStatementSignedAmount(
                  data.netMovementMinor,
                  data.currency,
                )}
              />
              <Summary
                label="Closing balance"
                value={amount(data.closingBalanceMinor, data.currency)}
                bold
              />
            </>
          )}
        <Summary
          label="Transactions"
          value={`${data.transactionCount}`}
        />
        {data.reconciles === false
          ? (
            <Text style={styles.note}>
              The balances above do not reconcile against the transactions
              listed. See the coverage notes — one or more transactions may be
              missing from OneLedger&apos;s records.
            </Text>
          )
          : null}

        <Text style={styles.sectionTitle}>Transactions</Text>
        {data.lines.length === 0
          ? <Text>No transactions in this period.</Text>
          : (
            <>
              <TableHeader mixed={mixed} />
              {data.lines.map((line, i) => (
                <TxnRow
                  key={`${line.occurredAt}-${i}`}
                  line={line}
                  data={data}
                  mixed={mixed}
                />
              ))}
            </>
          )}

        <Text style={styles.disclaimer}>
          Statement {data.statementId}. Generated by OneLedger on{" "}
          {generatedLabel} from the financial records available to the account
          holder at the time of generation. This document is generated by
          OneLedger and is not an official statement issued by the originating
          financial provider.
        </Text>

        <View style={styles.footer} fixed>
          <Text>{data.statementId}</Text>
          <Text>Generated {generatedLabel}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

export const STATEMENT_PDF_TEMPLATE_VERSION = TEMPLATE_VERSION;

export async function renderStatementPdf(data: StatementDocData): Promise<Buffer> {
  return await renderToBuffer(<StatementDocument data={data} />);
}
