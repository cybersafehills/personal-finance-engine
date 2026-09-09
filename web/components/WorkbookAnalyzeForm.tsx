"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeWorkbookUpload,
  createImportBatchesFromWorkbook,
  type WorkbookAnalyzeResult,
} from "../app/integrations/imports/actions";

const ACCEPT = ".csv,.xlsx";
const MAX_MB = 10;

type Analysis = Extract<WorkbookAnalyzeResult, { ok: true }>["analysis"];

function kindLabel(kind: string): string {
  if (kind === "transactions") return "Transactions";
  if (kind === "empty") return "Empty";
  return "Not recognised";
}

export function WorkbookAnalyzeForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const candidateNames = useMemo(
    () =>
      analysis
        ? analysis.sheets.filter((s) => s.kind === "transactions").map((s) => s.name)
        : [],
    [analysis],
  );

  function reset(next: File | null) {
    setFile(next);
    setAnalysis(null);
    setSelected(new Set());
    setError(null);
  }

  function analyze() {
    if (!file || pending) return;
    setError(null);
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      const result = await analyzeWorkbookUpload(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAnalysis(result.analysis);
      setSelected(
        new Set(result.analysis.sheets.filter((s) => s.recommended).map((s) => s.name)),
      );
    });
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function create() {
    if (!file || selected.size === 0 || pending) return;
    setError(null);
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      const result = await createImportBatchesFromWorkbook(data, [...selected]);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/integrations/imports");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
        <label className="text-sm font-medium text-text-primary">
          {file ? file.name : "Choose a workbook (.xlsx) or CSV file"}
        </label>
        <p className="text-xs text-text-muted">Up to {MAX_MB} MB.</p>
        <input
          type="file"
          accept={ACCEPT}
          className="text-sm text-text-secondary file:mr-3 file:min-h-11 file:rounded-control file:border file:border-border-subtle file:bg-background file:px-4 file:text-base file:font-medium file:text-text-primary"
          onChange={(e) => reset(e.target.files?.[0] ?? null)}
        />
        {!analysis && (
          <button
            type="button"
            onClick={analyze}
            disabled={!file || pending}
            className="mt-1 min-h-11 self-start rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50"
          >
            {pending ? "Analyzing…" : "Analyze workbook"}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-sm text-attention"
        >
          {error}
        </p>
      )}

      {analysis && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            {analysis.sheetCount}{" "}
            {analysis.sheetCount === 1 ? "sheet" : "sheets"} found ·{" "}
            {analysis.candidateSheets} look like transactions (
            {analysis.candidateRows} rows ready). Pick the ones to import — each
            becomes its own import you’ll review before committing.
          </p>

          <ul className="flex flex-col gap-2">
            {analysis.sheets.map((sheet) => {
              const selectable = sheet.kind === "transactions";
              return (
                <li
                  key={sheet.name}
                  className={`rounded-card border border-border-subtle bg-surface p-4 ${
                    selectable ? "" : "opacity-70"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={selected.has(sheet.name)}
                      disabled={!selectable || pending}
                      onChange={() => toggle(sheet.name)}
                      aria-label={`Import the "${sheet.name}" sheet`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">
                          {sheet.name}
                        </span>
                        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-text-secondary">
                          {kindLabel(sheet.kind)}
                        </span>
                        {sheet.kind === "transactions" && (
                          <span className="rounded-full bg-background px-2 py-0.5 text-xs text-text-muted">
                            {sheet.confidence} confidence
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-text-muted">{sheet.note}</p>
                      {sheet.kind === "transactions" && (
                        <p className="mt-1 text-xs text-text-muted">
                          {sheet.readyRows} ready · {sheet.invalidRows} need
                          attention
                          {sheet.dateRange
                            ? ` · ${sheet.dateRange.start.slice(0, 10)} to ${sheet.dateRange.end.slice(0, 10)}`
                            : ""}
                          {sheet.currencyGuess ? ` · ${sheet.currencyGuess}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={create}
              disabled={selected.size === 0 || pending}
              className="min-h-11 rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50"
            >
              {pending
                ? "Preparing…"
                : `Import ${selected.size || ""} ${
                  selected.size === 1 ? "sheet" : "sheets"
                }`.trim()}
            </button>
            {candidateNames.length > 0 && selected.size < candidateNames.length && (
              <button
                type="button"
                onClick={() => setSelected(new Set(candidateNames))}
                disabled={pending}
                className="text-sm font-medium text-accent hover:underline"
              >
                Select all candidates
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
