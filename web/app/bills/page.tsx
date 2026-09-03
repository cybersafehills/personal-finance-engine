import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { BillStatusBadge } from "../../components/bills/BillStatusBadge";
import { BillUploadForm } from "../../components/bills/BillUploadForm";
import { BillListFilters } from "../../components/bills/BillListFilters";
import { isBillsEnabled } from "../../lib/bills/gate";
import {
  getActiveBillContext,
  getBillDocuments,
  type BillDocumentStatus,
} from "../../lib/bills/queries";
import { formatFullDateTime } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { workspaceId, permissions } = await getActiveBillContext();
  if (!isBillsEnabled(workspaceId)) {
    notFound();
  }

  const { status } = await searchParams;
  const documents = await getBillDocuments({
    limit: 100,
    status: (status as BillDocumentStatus | undefined) ?? "all",
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Bills & Expenses"
        subtitle="Upload an invoice or receipt. The exact original is kept as evidence and every step is recorded."
      />

      <BillUploadForm canUpload={permissions.canUpload} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-secondary">Documents</h2>
        <BillListFilters active={status ?? ""} />
        {documents.length === 0 ? (
          <EmptyState
            title={status ? "Nothing here" : "No documents yet"}
            description={
              status
                ? "No documents match this filter."
                : "Uploaded invoices and receipts appear here with their processing status."
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((doc) => (
              <li key={doc.id}>
                <Link
                  href={`/bills/${doc.id}`}
                  className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">
                      {doc.sanitized_filename}
                    </span>
                    <BillStatusBadge status={doc.status} />
                  </div>
                  <p className="text-xs text-text-muted">
                    Uploaded {formatFullDateTime(doc.uploaded_at)}
                    {doc.page_count ? ` · ${doc.page_count} page${doc.page_count === 1 ? "" : "s"}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
