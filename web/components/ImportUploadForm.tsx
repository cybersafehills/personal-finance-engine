"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadImportFile } from "../app/integrations/imports/actions";

const ACCEPT = ".csv,.xlsx";
const MAX_MB = 10;

export function ImportUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick(selected: File | null) {
    setError(null);
    setFile(selected);
  }

  function submit() {
    if (!file || isPending) return;
    setError(null);
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      const result = await uploadImportFile(data);
      if (result.ok) {
        router.push(`/integrations/imports/${result.batchId}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files?.[0] ?? null);
        }}
        className={`flex flex-col items-center gap-2 rounded-card border border-dashed p-8 text-center transition-colors ${
          dragging
            ? "border-accent bg-background"
            : "border-border-subtle bg-surface"
        }`}
      >
        <p className="text-sm font-medium text-text-primary">
          {file ? file.name : "Drop a CSV or Excel file here"}
        </p>
        <p className="text-xs text-text-muted">
          Accepted: .csv, .xlsx · up to {MAX_MB} MB
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-1 min-h-11 rounded-control border border-border-subtle bg-background px-4 text-base font-medium text-text-primary"
        >
          {file ? "Choose a different file" : "Choose a file"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-sm text-attention"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!file || isPending}
          className="min-h-11 rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Uploading…" : "Upload and detect"}
        </button>
        {file && !isPending && (
          <button
            type="button"
            onClick={() => pick(null)}
            className="min-h-11 rounded-control px-3 text-sm font-medium text-text-secondary hover:bg-background"
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
