import { getTransferCandidates, getTransferLinks } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { TransferCandidateItem } from "../../../components/TransferCandidateItem";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const [candidates, links] = await Promise.all([
    getTransferCandidates(),
    getTransferLinks(),
  ]);
  const linkedCount = links.filter((l) => l.status === "linked").length;

  return (
    <div>
      <PageHeader
        title="Possible transfers"
        subtitle="Money moving between your own accounts, not spending or income"
      />

      <p className="mb-4 text-xs text-text-muted">
        These are suggestions based on matching amounts and timing across
        your accounts, not a certainty - confirm only pairs you recognize.
        Confirmed transfers are excluded from budget spending and income
        totals. {linkedCount > 0 && `${linkedCount} transfer${linkedCount === 1 ? "" : "s"} confirmed so far.`}
      </p>

      {candidates.length === 0 ? (
        <EmptyState
          title="No possible transfers found"
          description="We'll suggest a pair here when a payment out of one account closely matches a deposit into another within 60 days."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {candidates.map((c) => (
            <TransferCandidateItem key={`${c.outTransactionId}-${c.inTransactionId}`} candidate={c} />
          ))}
        </div>
      )}
    </div>
  );
}
