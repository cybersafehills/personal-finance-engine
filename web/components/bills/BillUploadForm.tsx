"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadBillDocument } from "../../app/bills/actions";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif";

// Upload control for Bills & Expenses Phase 1. Progressive-enhancement is
// limited (the action needs a File), so this is a client component; it
// keeps the browser informed with an explicit pending state, surfaces a
// typed rejection reason as plain text, and links straight to the
// existing copy when the file is a duplicate (master prompt §10/§21).

export function BillUploadForm({ canUpload }: { canUpload: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  if (!canUpload) {
    return (
      <p className="rounded-card border border-border-subtle bg-surface p-4 text-sm text-text-muted">
        You don&rsquo;t have permission to upload documents in this workspace.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setDuplicateId(null);
        const file = inputRef.current?.files?.[0];
        if (!file) {
          setError("Choose a file to upload.");
          return;
        }
        const formData = new FormData();
        formData.set("file", file);
        startTransition(async () => {
          const result = await uploadBillDocument(formData);
          if (result.ok) {
            if (inputRef.current) inputRef.current.value = "";
            setFileName(null);
            router.push(`/bills/${result.id}`);
            return;
          }
          setError(result.error);
          if (result.code === "duplicate_document" && result.existingId) {
            setDuplicateId(result.existingId);
          }
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Add an invoice or receipt</span>
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept={ACCEPT}
          required
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-control file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-foreground"
        />
        <span className="text-xs text-text-muted">
          PDF, JPEG, PNG or HEIC. The original is stored exactly as uploaded.
        </span>
      </label>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Uploading…" : "Upload"}
        </button>
        {fileName && !isPending && (
          <span className="truncate text-xs text-text-muted" title={fileName}>
            {fileName}
          </span>
        )}
      </div>

      {isPending && (
        <p role="status" className="text-sm text-text-muted">
          Uploading and storing the original…
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
          {duplicateId && (
            <>
              {" "}
              <Link href={`/bills/${duplicateId}`} className="font-medium text-accent hover:underline">
                View the existing document
              </Link>
              .
            </>
          )}
        </p>
      )}
    </form>
  );
}
