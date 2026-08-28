import { getMyFinancialSources } from "../../../../lib/queries";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { StatementImportFlow } from "../../../../components/StatementImportFlow";

export const dynamic = "force-dynamic";

const PROVIDER_LABELS: Record<string, string> = {
  mtn_momo: "MTN MoMo",
  airtel_money: "Airtel Money",
  bank: "Bank",
  card: "Card",
  cash: "Cash",
  statement: "Imported statement",
  other: "Other",
};

export default async function ImportStatementPage() {
  const sources = await getMyFinancialSources();
  const options = sources.map((s) => ({
    id: s.id,
    label: `${PROVIDER_LABELS[s.provider] ?? s.provider} · ${s.displayName}${
      s.maskedIdentifier ? ` · ${s.maskedIdentifier}` : ""
    }`,
  }));

  return (
    <div>
      <PageHeader
        title="Import a statement"
        subtitle="Upload a CSV export from your bank or wallet. Lines that already exist in OneLedger are flagged for review, not duplicated."
        backHref="/settings/sources"
      />

      {options.length === 0
        ? (
          <EmptyState
            title="No accounts yet"
            description="Add an account under Settings → Accounts first, then come back to import its statement."
          />
        )
        : <StatementImportFlow sources={options} />}
    </div>
  );
}
