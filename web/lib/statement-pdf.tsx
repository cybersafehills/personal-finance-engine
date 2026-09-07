import "server-only";
import {
  Document,
  Page,
  Rect,
  renderToBuffer,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  formatStatementAmount,
  formatStatementSignedAmount,
  statementDateKey,
  type StatementDocData,
  type StatementDocLine,
} from "./statement-document";
import { qrMatrix } from "./qr";

function verifyUrl(token: string): string | null {
  const base = process.env.SITE_URL?.replace(/\/$/, "");
  return base ? `${base}/verify/${token}` : null;
}

// OneLedger brand palette. Navy + blue are sampled verbatim from the
// approved brand artwork (docs/ONELEDGER_BRAND_ASSETS.md); the light-blue
// tints are derived washes used only as background fills, never as the
// mark's ink. These are the single source of colour for this document -
// every accent below refers back to one of them.
const BRAND_NAVY = "#07143a";
const BRAND_BLUE = "#0050f4";
const BRAND_BLUE_TINT = "#eef3ff"; // zebra / panel wash
const BRAND_BLUE_TINT_STRONG = "#dbe6ff"; // highlighted closing-balance row

/** A small QR block for the verification URL, drawn as react-pdf primitives (no image decoding). */
function VerifyQr({ url, size = 66 }: { url: string; size?: number }) {
  const matrix = qrMatrix(url);
  const n = matrix.length;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
      {matrix.flatMap((row, y) =>
        row.map((on, x) =>
          on
            ? (
              <Rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={BRAND_NAVY}
              />
            )
            : null
        )
      )}
    </Svg>
  );
}

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

const TEMPLATE_VERSION = 2;

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 54,
    paddingHorizontal: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111111",
  },
  // Thin navy rule across the very top of every page, with a short blue
  // segment at the right - a flat echo of the brand mark (navy field,
  // blue corner), not a recreation of the logo itself.
  topAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: BRAND_NAVY,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  topAccentBlue: { width: 48, height: 5, backgroundColor: BRAND_BLUE },
  runningHeader: {
    position: "absolute",
    top: 18,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#8b93a6",
  },
  brand: {
    fontSize: 11,
    color: BRAND_NAVY,
    fontWeight: 700,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2, color: BRAND_NAVY },
  subtitle: { fontSize: 9, color: "#666666", marginBottom: 14 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    marginTop: 14,
    marginBottom: 5,
    paddingBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: BRAND_NAVY,
    borderBottomWidth: 1.5,
    borderBottomColor: BRAND_BLUE,
  },
  infoRow: { flexDirection: "row", paddingVertical: 1.5 },
  infoLabel: { width: 130, color: "#666666" },
  infoValue: { flex: 1 },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
  },
  summaryRowHighlight: {
    backgroundColor: BRAND_BLUE_TINT_STRONG,
    borderBottomColor: BRAND_BLUE,
  },
  summaryLabel: { color: "#666666" },
  summaryLabelHighlight: { color: BRAND_NAVY },
  summaryValueBold: { fontWeight: 700 },
  summaryValueHighlight: { fontWeight: 700, color: BRAND_NAVY },
  note: { fontSize: 8, color: "#8a6d00", marginTop: 4 },
  coverageNote: { fontSize: 8, color: "#666666", marginTop: 2 },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: BRAND_NAVY,
    color: "#ffffff",
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginTop: 6,
    fontSize: 8,
    fontWeight: 700,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e4e9f2",
    paddingVertical: 2.5,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  rowAlt: { backgroundColor: BRAND_BLUE_TINT },
  cellDate: { width: 58 },
  cellDesc: { flex: 1, paddingRight: 4 },
  cellRef: { width: 76, color: "#555555" },
  cellCat: { width: 58, color: "#555555" },
  cellNum: { width: 62, textAlign: "right" },
  cellBalance: { width: 62, textAlign: "right", color: BRAND_NAVY },
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
    color: "#8b93a6",
    borderTopWidth: 1,
    borderTopColor: BRAND_BLUE,
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
  { label, value, bold = false, highlight = false }: {
    label: string;
    value: string;
    bold?: boolean;
    highlight?: boolean;
  },
) {
  return (
    <View
      style={highlight
        ? [styles.summaryRow, styles.summaryRowHighlight]
        : styles.summaryRow}
    >
      <Text
        style={highlight ? styles.summaryLabelHighlight : styles.summaryLabel}
      >
        {label}
      </Text>
      <Text
        style={highlight
          ? styles.summaryValueHighlight
          : bold
          ? styles.summaryValueBold
          : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

function amount(minor: number | null, currency: string): string {
  return minor === null ? "—" : formatStatementAmount(minor, currency);
}

function TableHeader({ mixed }: { mixed: boolean }) {
  // Cells reuse the width styles but force white text so the coloured
  // (#555) Reference / Cur. styles don't bleed through on the navy band.
  const h = { color: "#ffffff" };
  // Not `fixed`: a fixed element repeats on *every* page, including the
  // trailing page that only carries the disclaimer / QR, where a floating
  // navy band with no table under it looked broken. The running header
  // ("Statement <id>") already orients the reader on later pages.
  return (
    <View style={styles.tableHeaderRow}>
      <Text style={[styles.cellDate, h]}>Date</Text>
      <Text style={[styles.cellDesc, h]}>Description</Text>
      <Text style={[styles.cellRef, h]}>Reference</Text>
      <Text style={[styles.cellNum, h]}>Money In</Text>
      <Text style={[styles.cellNum, h]}>Money Out</Text>
      <Text style={[styles.cellNum, h]}>Balance</Text>
      {mixed ? <Text style={[styles.cellCur, h]}>Cur.</Text> : null}
    </View>
  );
}

function TxnRow(
  { line, data, mixed, index }: {
    line: StatementDocLine;
    data: StatementDocData;
    mixed: boolean;
    index: number;
  },
) {
  const inValue = line.direction === "in"
    ? formatStatementAmount(line.principalEffectMinor, data.currency)
    : "";
  const outValue = line.direction === "out"
    ? formatStatementAmount(line.principalEffectMinor, data.currency)
    : "";
  return (
    <View
      style={index % 2 === 1 ? [styles.row, styles.rowAlt] : styles.row}
      wrap={false}
    >
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
      <Text style={styles.cellBalance}>
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
  const generatedLabel =
    new Date(data.generatedAtIso).toISOString().slice(0, 16)
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
        <View style={styles.topAccent} fixed>
          <View style={styles.topAccentBlue} />
        </View>
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
                highlight
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
                value={formatStatementAmount(
                  data.totalCreditsMinor,
                  data.currency,
                )}
              />
              <Summary
                label="Money out"
                value={formatStatementAmount(
                  data.totalDebitsMinor,
                  data.currency,
                )}
              />
              <Summary
                label="Fees / charges"
                value={formatStatementAmount(
                  data.totalFeesMinor,
                  data.currency,
                )}
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
                highlight
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
                  index={i}
                />
              ))}
            </>
          )}

        <Text style={styles.disclaimer}>
          Statement {data.statementId}. Generated by OneLedger on{" "}
          {generatedLabel}{" "}
          from the financial records available to the account holder at the time
          of generation. This document is generated by OneLedger and is not an
          official statement issued by the originating financial provider.
        </Text>

        {data.verificationToken && verifyUrl(data.verificationToken)
          ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
              }}
              wrap={false}
            >
              <VerifyQr url={verifyUrl(data.verificationToken)!} />
              <Text style={styles.disclaimer}>
                Verify this document at{"\n"}
                {verifyUrl(data.verificationToken)}
              </Text>
            </View>
          )
          : null}

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

export async function renderStatementPdf(
  data: StatementDocData,
): Promise<Buffer> {
  return await renderToBuffer(<StatementDocument data={data} />);
}
