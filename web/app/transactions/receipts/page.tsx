import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { ReceiptReviewItem } from "../../../components/ReceiptReviewItem";
import { formatFullDateTime, formatRwf } from "../../../lib/format";
import { listOpenReceipts } from "../../../lib/utility-receipts";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const receipts = await listOpenReceipts();
  return (
    <div>
      <PageHeader
        title="Electricity receipts"
        subtitle="Cash Power receipts that aren't linked to a payment yet"
        backHref="/transactions"
        backLabel="Transactions"
      />
      <p className="mb-4 text-xs text-text-muted">
        When your electricity vendor sends a receipt, OneLedger links it to the MoMo payment of the
        same amount. If it can&apos;t be sure, it asks you here. The token itself is never shown on
        this page.
      </p>
      {receipts.length === 0 ? (
        <EmptyState title="Nothing to review" description="Every electricity receipt is linked to a payment." />
      ) : (
        <div className="flex flex-col gap-3">
          {receipts.map((r) => (
            <ReceiptReviewItem
              key={r.id}
              r={{
                id: r.id,
                status: r.status,
                amountText: formatRwf(r.amountRwf),
                kwh: r.kwh,
                meterLast4: r.meterLast4,
                whenText: formatFullDateTime(r.receiptAt),
                candidates: r.candidates.map((c) => ({
                  id: c.id,
                  whenText: formatFullDateTime(c.occurredAt),
                  who: c.counterpartyName ?? "Payment",
                })),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
