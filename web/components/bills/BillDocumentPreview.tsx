"use client";

import { useState } from "react";

// The document panel of the review workspace (Phase 7). PDFs render in a
// native <object>; images with <img>; both from the capability-gated
// signed-URL route. A client-side pdf.js viewer with source-region
// highlighting is a follow-up.

export function BillDocumentPreview({
  documentId,
  mimeType,
  canView,
}: {
  documentId: string;
  mimeType: string;
  canView: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = `/api/bills/${documentId}/original`;

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center rounded-card border border-border-subtle bg-surface p-4 text-center text-sm text-text-muted">
        You don&rsquo;t have permission to view the original document.
      </div>
    );
  }

  const isImage = mimeType.startsWith("image/");

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-card border border-border-subtle bg-surface">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt="Uploaded document"
            className="max-h-[75vh] w-full object-contain"
            onError={() => setFailed(true)}
          />
        ) : failed ? (
          <div className="flex h-64 items-center justify-center p-4 text-sm text-text-muted">
            The preview couldn&rsquo;t load.
          </div>
        ) : (
          <object data={src} type="application/pdf" className="h-[75vh] w-full" aria-label="Uploaded document">
            <div className="flex h-64 items-center justify-center p-4 text-sm text-text-muted">
              Your browser can&rsquo;t preview this here.
            </div>
          </object>
        )}
      </div>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="w-fit text-xs font-medium text-accent hover:underline"
      >
        Open the original in a new tab
      </a>
    </div>
  );
}
