"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteProviderStatementAction,
  uploadProviderStatementAction,
} from "../app/reports/statements/actions";

type SourceOption = { id: string; label: string };
type ProviderDoc = {
  id: string;
  provider: string;
  originalFilename: string;
  periodStart: string | null;
  periodEnd: string | null;
  byteSize: number;
  note: string | null;
  createdAt: string;
};

const inputClass =
  "min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProviderStatements({
  documents,
  sources,
}: {
  documents: ProviderDoc[];
  sources: SourceOption[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const [deleting, startDelete] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startUpload(async () => {
      const result = await uploadProviderStatementAction(formData);
      if (result.ok) {
        formRef.current?.reset();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-text-muted">
        Keep the original PDF or CSV your bank or wallet issued alongside your
        OneLedger-generated statements. These files are stored as uploaded and
        are never parsed or changed.
      </p>

      {documents.length > 0 && (
        <ul className="flex flex-col gap-2">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-2 rounded-control border border-border-subtle bg-background px-3 py-2"
            >
              <span className="font-medium text-text-primary">{d.provider}</span>
              <span className="text-xs text-text-muted">
                {d.originalFilename} · {humanSize(d.byteSize)}
                {d.periodStart && d.periodEnd
                  ? ` · ${d.periodStart} → ${d.periodEnd}`
                  : ""}
              </span>
              {d.note && (
                <span className="w-full text-xs text-text-muted">{d.note}</span>
              )}
              <a
                href={`/api/reports/statements/provider/${d.id}`}
                className="ml-auto text-xs font-medium text-accent"
              >
                Download
              </a>
              <button
                type="button"
                disabled={deleting}
                onClick={() =>
                  startDelete(async () => {
                    await deleteProviderStatementAction(d.id);
                    router.refresh();
                  })}
                className="text-xs font-medium text-attention disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="flex flex-col gap-3 border-t border-border-subtle pt-3"
      >
        <p className="font-medium text-text-primary">Upload a provider document</p>

        {error && (
          <p
            role="alert"
            className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-attention"
          >
            {error}
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="font-medium text-text-primary">Provider</span>
          <input
            name="provider"
            type="text"
            required
            maxLength={80}
            placeholder="e.g. MTN MoMo, Bank of Kigali"
            className={inputClass}
          />
        </label>

        {sources.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="font-medium text-text-primary">
              Account{" "}
              <span className="font-normal text-text-muted">(optional)</span>
            </span>
            <select name="financialSourceId" className={inputClass} defaultValue="">
              <option value="">Not linked to an account</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-text-primary">
              Period start{" "}
              <span className="font-normal text-text-muted">(optional)</span>
            </span>
            <input name="periodStart" type="date" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-text-primary">
              Period end{" "}
              <span className="font-normal text-text-muted">(optional)</span>
            </span>
            <input name="periodEnd" type="date" className={inputClass} />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-text-primary">
            Note <span className="font-normal text-text-muted">(optional)</span>
          </span>
          <input
            name="note"
            type="text"
            maxLength={500}
            placeholder="Where this came from, anything worth recording"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-text-primary">File</span>
          <input
            name="file"
            type="file"
            required
            accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv"
            className="text-sm text-text-primary"
          />
          <span className="text-xs text-text-muted">
            PDF, CSV or spreadsheet, up to 15 MB.
          </span>
        </label>

        <div>
          <button
            type="submit"
            disabled={uploading}
            className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload document"}
          </button>
        </div>
      </form>
    </div>
  );
}
