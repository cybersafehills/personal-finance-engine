import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { BillStatusBadge } from "../../../components/bills/BillStatusBadge";
import { BillProcessingTimeline } from "../../../components/bills/BillProcessingTimeline";
import { BillArchiveButton } from "../../../components/bills/BillArchiveButton";
import { BillDocumentPreview } from "../../../components/bills/BillDocumentPreview";
import { BillFieldsEditor } from "../../../components/bills/BillFieldsEditor";
import { BillValidationFindings } from "../../../components/bills/BillValidationFindings";
import { BillDuplicateCandidates } from "../../../components/bills/BillDuplicateCandidates";
import { BillSupplierPanel } from "../../../components/bills/BillSupplierPanel";
import { BillLedgerPanel } from "../../../components/bills/BillLedgerPanel";
import { BillComments } from "../../../components/bills/BillComments";
import { BillRetryButton } from "../../../components/bills/BillRetryButton";
import { isBillsEnabled, isBillsExtractionEnabled } from "../../../lib/bills/gate";
import {
  getActiveBillContext,
  getBillComments,
  getBillDocumentById,
  getBillDuplicateCandidates,
  getBillLedger,
  getBillProcessingEvents,
  getBillSupplierCandidates,
  getBillSupplierLink,
  getCurrentBillExtraction,
  getCurrentBillValidation,
} from "../../../lib/bills/queries";
import { formatFullDateTime } from "../../../lib/format";

export const dynamic = "force-dynamic";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const MIME_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/heic": "HEIC image",
  "image/heif": "HEIF image",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text-secondary">{title}</h2>
      {children}
    </section>
  );
}

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspaceId, permissions } = await getActiveBillContext();
  if (!isBillsEnabled(workspaceId)) {
    notFound();
  }

  const doc = await getBillDocumentById(id);
  if (!doc) {
    notFound();
  }

  const extractionEnabled = isBillsExtractionEnabled(workspaceId);
  const events = permissions.canViewAudit ? await getBillProcessingEvents(id) : [];
  const canArchive =
    permissions.canManage && doc.retention_status !== "archived" && doc.status !== "archived";

  const [bundle, validation, duplicates, supplierLink, supplierCandidates, ledger, comments] =
    extractionEnabled
      ? await Promise.all([
          getCurrentBillExtraction(id),
          getCurrentBillValidation(id),
          getBillDuplicateCandidates(id),
          getBillSupplierLink(id),
          getBillSupplierCandidates(id),
          getBillLedger(id),
          getBillComments(id),
        ])
      : [null, null, [], null, [], null, []];

  const extractedName =
    bundle?.fields.find((f) => f.field_key === "supplier_name")?.normalized_value ??
    bundle?.fields.find((f) => f.field_key === "supplier_name")?.raw_value ??
    null;
  const extractedTaxId =
    bundle?.fields.find((f) => f.field_key === "supplier_tax_id")?.raw_value ?? null;
  const canRetry =
    permissions.canReview &&
    (doc.status === "processing_failed" || bundle?.extraction?.status === "failed");
  const validationStale =
    !!bundle?.extraction &&
    !!validation?.validation &&
    validation.validation.review_revision !== doc.review_revision;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={doc.sanitized_filename}
        subtitle="Source document — extracted claims are not the same as verified data."
        backHref="/bills"
        backLabel="All documents"
        action={<BillStatusBadge status={doc.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Document */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <BillDocumentPreview
            documentId={doc.id}
            mimeType={doc.mime_type}
            canView={permissions.canDownloadOriginal}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {canArchive && <BillArchiveButton id={doc.id} />}
            {canRetry && <BillRetryButton id={doc.id} />}
          </div>
        </div>

        {/* Review */}
        <div className="flex flex-col gap-6">
          {extractionEnabled ? (
            <>
              <Section title="Fields">
                <BillFieldsEditor
                  documentId={doc.id}
                  extraction={bundle?.extraction ?? null}
                  fields={bundle?.fields ?? []}
                  lineItems={bundle?.lineItems ?? []}
                  canReview={permissions.canReview}
                  validationStale={validationStale}
                />
              </Section>

              <Section title="Checks">
                <BillValidationFindings
                  validation={validation?.validation ?? null}
                  findings={validation?.findings ?? []}
                />
              </Section>

              <Section title="Supplier">
                <BillSupplierPanel
                  documentId={doc.id}
                  linked={supplierLink}
                  candidates={supplierCandidates}
                  canReview={permissions.canReview}
                  canManage={permissions.canManage}
                  extractedName={extractedName}
                  extractedTaxId={extractedTaxId}
                />
              </Section>

              <Section title="Possible duplicates">
                <BillDuplicateCandidates
                  documentId={doc.id}
                  candidates={duplicates}
                  canReview={permissions.canReview}
                />
              </Section>

              {ledger && (
                <Section title="Approval & ledger">
                  <BillLedgerPanel
                    documentId={doc.id}
                    status={doc.status}
                    ledger={ledger}
                    canApprove={permissions.canApprove}
                    canPost={permissions.canPost}
                    canReview={permissions.canReview}
                  />
                </Section>
              )}

              <Section title="Notes">
                <BillComments
                  documentId={doc.id}
                  comments={comments}
                  canComment={permissions.canReview}
                />
              </Section>
            </>
          ) : (
            <p className="text-sm text-text-muted">
              Automated extraction isn&rsquo;t enabled for this workspace. The original is
              stored and its processing history is below.
            </p>
          )}

          <Section title="Processing history">
            {permissions.canViewAudit ? (
              <BillProcessingTimeline events={events} />
            ) : (
              <p className="text-sm text-text-muted">
                You don&rsquo;t have permission to view this document&rsquo;s processing
                history.
              </p>
            )}
          </Section>

          <details className="rounded-card border border-border-subtle bg-surface p-4 text-sm">
            <summary className="cursor-pointer font-medium text-text-secondary">
              Document details
            </summary>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <div>
                <dt className="text-text-muted">Type</dt>
                <dd className="text-text-primary">{MIME_LABEL[doc.mime_type] ?? doc.mime_type}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Size</dt>
                <dd className="text-text-primary">{formatBytes(doc.byte_size)}</dd>
              </div>
              {doc.page_count != null && (
                <div>
                  <dt className="text-text-muted">Pages</dt>
                  <dd className="text-text-primary">{doc.page_count}</dd>
                </div>
              )}
              <div>
                <dt className="text-text-muted">Uploaded</dt>
                <dd className="text-text-primary">{formatFullDateTime(doc.uploaded_at)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Security scan</dt>
                <dd className="text-text-primary">{doc.security_scan_status}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Retention</dt>
                <dd className="text-text-primary">{doc.retention_status}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-text-muted">Checksum (SHA-256)</dt>
                <dd className="break-all font-mono text-xs text-text-secondary">
                  {doc.checksum_sha256}
                </dd>
              </div>
            </dl>
          </details>

          <p className="text-xs text-text-muted">
            <Link href="/bills" className="text-accent hover:underline">
              Back to all documents
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
