import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { BillStatusBadge } from "../../../components/bills/BillStatusBadge";
import { BillProcessingTimeline } from "../../../components/bills/BillProcessingTimeline";
import { BillArchiveButton } from "../../../components/bills/BillArchiveButton";
import { BillExtractedFields } from "../../../components/bills/BillExtractedFields";
import { BillRetryButton } from "../../../components/bills/BillRetryButton";
import { isBillsEnabled, isBillsExtractionEnabled } from "../../../lib/bills/gate";
import {
  getActiveBillContext,
  getBillDocumentById,
  getBillProcessingEvents,
  getCurrentBillExtraction,
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

  const events = permissions.canViewAudit ? await getBillProcessingEvents(id) : [];
  const canArchive = permissions.canManage && doc.retention_status !== "archived" && doc.status !== "archived";

  const extractionEnabled = isBillsExtractionEnabled(workspaceId);
  const bundle = extractionEnabled ? await getCurrentBillExtraction(id) : null;
  const canRetry =
    permissions.canReview &&
    (doc.status === "processing_failed" || bundle?.extraction?.status === "failed");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={doc.sanitized_filename}
        subtitle="Source document — extracted claims are not the same as verified data."
        backHref="/bills"
        backLabel="All documents"
        action={<BillStatusBadge status={doc.status} />}
      />

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-card border border-border-subtle bg-surface p-4 text-sm sm:grid-cols-2">
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
          <dd className="break-all font-mono text-xs text-text-secondary">{doc.checksum_sha256}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        {permissions.canDownloadOriginal ? (
          <a
            href={`/api/bills/${doc.id}/original`}
            className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
          >
            Download original
          </a>
        ) : (
          <span className="text-sm text-text-muted">
            You don&rsquo;t have permission to download the original.
          </span>
        )}
        {canArchive && <BillArchiveButton id={doc.id} />}
        {canRetry && <BillRetryButton id={doc.id} />}
      </div>

      {extractionEnabled && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text-secondary">Extracted details</h2>
          <BillExtractedFields
            extraction={bundle?.extraction ?? null}
            fields={bundle?.fields ?? []}
            lineItems={bundle?.lineItems ?? []}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-secondary">Processing history</h2>
        {permissions.canViewAudit ? (
          <BillProcessingTimeline events={events} />
        ) : (
          <p className="text-sm text-text-muted">
            You don&rsquo;t have permission to view this document&rsquo;s processing history.
          </p>
        )}
      </section>

      <p className="text-xs text-text-muted">
        Editing and approving extracted fields arrives in a later release.{" "}
        <Link href="/bills" className="text-accent hover:underline">
          Back to all documents
        </Link>
        .
      </p>
    </div>
  );
}
