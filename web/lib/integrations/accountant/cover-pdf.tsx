import "server-only";
import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

// One-page cover sheet for a "Ready for Accountant" package. Pure layout -
// no financial calculation here; every number is passed in already
// computed by build.ts. Same @react-pdf/renderer approach as
// web/lib/report-pdf.tsx (no headless browser).

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111111" },
  brand: { fontSize: 10, color: "#666666", marginBottom: 4 },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 11, color: "#666666", marginBottom: 20 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginTop: 18,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
  },
  rowLabel: { color: "#666666" },
  rowValue: { fontWeight: 700 },
  item: { paddingVertical: 2, color: "#333333" },
  note: { fontSize: 8, color: "#999999", marginTop: 18, lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#999999",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e5e5",
    paddingTop: 6,
  },
});

export type AccountantCoverData = {
  workspaceName: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  generatedAtLabel: string;
  transactionCount: number;
  accountCount: number;
  contents: string[];
  reconciliation: {
    openItems: number;
    balanceMismatches: number;
  };
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function CoverDocument({ data }: { data: AccountantCoverData }) {
  return (
    <Document title={`OneLedger — Accountant package (${data.periodLabel})`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>OneLedger</Text>
        <Text style={styles.title}>Ready for Accountant</Text>
        <Text style={styles.subtitle}>
          {data.workspaceName} · {data.periodLabel}
        </Text>

        <Text style={styles.sectionTitle}>Period</Text>
        <Row label="Label" value={data.periodLabel} />
        <Row label="From" value={data.periodFrom.slice(0, 10)} />
        <Row label="To" value={data.periodTo.slice(0, 10)} />
        <Row label="Generated" value={data.generatedAtLabel} />

        <Text style={styles.sectionTitle}>Contents</Text>
        <Row label="Transactions" value={String(data.transactionCount)} />
        <Row label="Accounts" value={String(data.accountCount)} />
        {data.contents.map((c) => (
          <Text key={c} style={styles.item}>• {c}</Text>
        ))}

        <Text style={styles.sectionTitle}>Reconciliation status</Text>
        <Row
          label="Open reconciliation items"
          value={String(data.reconciliation.openItems)}
        />
        <Row
          label="Balance-drift checkpoints"
          value={String(data.reconciliation.balanceMismatches)}
        />

        <Text style={styles.note}>
          {"This package is an export of ledger data recorded in OneLedger as " +
            "of the generated-at time above. Figures are integer minor units in " +
            "each account's own currency. OneLedger is a record-keeping tool, " +
            "not an accounting authority — reconciliation items listed above " +
            "still need a human decision and may change the final numbers."}
        </Text>

        <Text style={styles.footer} fixed>
          OneLedger · Ready for Accountant · {data.generatedAtLabel}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderAccountantCoverPdf(
  data: AccountantCoverData,
): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<CoverDocument data={data} />);
  return new Uint8Array(buffer);
}
