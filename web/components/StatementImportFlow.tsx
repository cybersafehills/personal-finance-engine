"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { parseCsv } from "../lib/csv";
import {
  type ColumnMapping,
  type DateOrder,
  type DirectionStrategy,
  guessMapping,
  normalizeStatementRows,
} from "../lib/statement-import";
import {
  importStatement,
  type ImportStatementResult,
} from "../app/settings/sources/import/actions";
import { formatRwf } from "../lib/format";
import {
  pdfItemsToStatementRows,
  type PdfTextItem,
} from "../lib/pdf-statement";

// PDF text extraction runs entirely in the browser via pdf.js, loaded on
// demand so the CSV path stays dependency-free. Text-layer PDFs (bank /
// wallet exports) work; scanned images do not - CSV is the fallback.
async function extractPdfRows(
  file: File,
): Promise<{ headers: string[]; rows: string[][] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const items: PdfTextItem[] = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Push each later page's y downward in a shared coordinate space so
    // itemsToLines never merges lines across a page break.
    const pageOffset = (doc.numPages - p) * 100_000;
    for (const it of content.items) {
      if (!("str" in it) || typeof it.str !== "string") continue;
      const tr = it.transform as number[];
      items.push({ str: it.str, x: tr[4], y: tr[5] + pageOffset });
    }
  }
  return pdfItemsToStatementRows(items);
}

const INPUT_CLASS =
  "min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary";

const DIRECTION_STRATEGIES: Array<{ value: DirectionStrategy; label: string }> = [
  { value: "sign", label: "The amount's sign (− is money out, + is money in)" },
  { value: "column", label: "A column that says debit / credit (or in / out)" },
  { value: "all_out", label: "Every row is money out" },
  { value: "all_in", label: "Every row is money in" },
];

const DATE_ORDERS: Array<{ value: DateOrder; label: string }> = [
  { value: "dmy", label: "Day first (31/12/2026)" },
  { value: "mdy", label: "Month first (12/31/2026)" },
  { value: "iso", label: "Year first (2026-12-31)" },
];

const PREVIEW_LIMIT = 8;

export function StatementImportFlow({
  sources,
  pdfEnabled = false,
}: {
  sources: Array<{ id: string; label: string }>;
  pdfEnabled?: boolean;
}) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);

  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<
    Extract<ImportStatementResult, { ok: true }> | null
  >(null);

  function applyParsed(parsed: { headers: string[]; rows: string[][] }) {
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping({
      date: 0,
      amount: 0,
      counterparty: null,
      externalRef: null,
      directionStrategy: "sign",
      directionColumn: null,
      dateOrder: "dmy",
      ...guessMapping(parsed.headers),
    });
  }

  async function onFile(file: File) {
    setParseError(null);
    setActionError(null);
    setResult(null);
    setFileName(file.name);
    setHeaders([]);
    setRows([]);
    setMapping(null);

    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    if (isPdf) {
      if (!pdfEnabled) {
        setParseError("PDF import isn't available yet - export a CSV instead.");
        return;
      }
      try {
        const parsed = await extractPdfRows(file);
        if (parsed.rows.length === 0) {
          setParseError(
            "No dated transaction lines were found in that PDF. If it's a scanned image, export a CSV instead.",
          );
          return;
        }
        applyParsed(parsed);
      } catch {
        setParseError("That PDF could not be read.");
      }
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setParseError("That file has no header row and rows we could read.");
        return;
      }
      applyParsed(parsed);
    } catch {
      setParseError("That file could not be read as text.");
    }
  }

  const normalized = useMemo(
    () => (mapping ? normalizeStatementRows(rows, mapping) : null),
    [rows, mapping],
  );

  function setMap<K extends keyof ColumnMapping>(key: K, value: ColumnMapping[K]) {
    setMapping((m) => (m ? { ...m, [key]: value } : m));
  }

  function runImport() {
    if (!mapping || !normalized || normalized.rows.length === 0) return;
    setActionError(null);
    startTransition(async () => {
      const res = await importStatement(sourceId, normalized.rows);
      if (!res.ok) {
        setActionError(res.error);
        return;
      }
      setResult(res);
    });
  }

  // ---- result screen ------------------------------------------------------
  if (result) {
    return (
      <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-5">
        <div>
          <p className="text-base font-medium text-text-primary">
            Statement imported
          </p>
          <p className="mt-1 text-sm text-text-muted">{fileName}</p>
        </div>
        <dl className="flex flex-col divide-y divide-border-subtle text-sm">
          <SummaryRow label="Transactions added" value={result.created} />
          <SummaryRow
            label="Flagged as possible duplicates"
            value={result.flaggedPossibleDuplicate}
          />
          <SummaryRow label="Rows skipped" value={result.skipped} />
        </dl>
        <div className="flex flex-wrap gap-3">
          {result.flaggedPossibleDuplicate > 0 && (
            <Link
              href="/transactions/review"
              className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
            >
              Review {result.flaggedPossibleDuplicate} possible duplicate
              {result.flaggedPossibleDuplicate === 1 ? "" : "s"}
            </Link>
          )}
          <Link
            href="/transactions"
            className="min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-medium text-text-secondary"
          >
            View transactions
          </Link>
        </div>
      </div>
    );
  }

  // ---- wizard -----------------------------------------------------------
  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Account</span>
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className={INPUT_CLASS}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">
          Statement file ({pdfEnabled ? "CSV or PDF" : "CSV"})
        </span>
        <input
          type="file"
          accept={pdfEnabled ? ".csv,text/csv,.pdf,application/pdf" : ".csv,text/csv"}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
          className="text-sm text-text-primary file:mr-3 file:min-h-9 file:rounded-control file:border-0 file:bg-accent file:px-3 file:text-sm file:font-medium file:text-accent-foreground"
        />
        {parseError && (
          <span role="alert" className="text-xs text-attention">
            {parseError}
          </span>
        )}
      </label>

      {mapping && normalized && (
        <>
          <div className="rounded-card border border-border-subtle bg-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Match the columns
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ColumnSelect
                label="Date"
                headers={headers}
                value={mapping.date}
                onChange={(v) => setMap("date", v ?? 0)}
              />
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-text-secondary">
                  Date format
                </span>
                <select
                  value={mapping.dateOrder}
                  onChange={(e) =>
                    setMap("dateOrder", e.target.value as DateOrder)}
                  className={INPUT_CLASS}
                >
                  {DATE_ORDERS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <ColumnSelect
                label="Amount"
                headers={headers}
                value={mapping.amount}
                onChange={(v) => setMap("amount", v ?? 0)}
              />
              <ColumnSelect
                label="Description / counterparty (optional)"
                headers={headers}
                value={mapping.counterparty}
                optional
                onChange={(v) => setMap("counterparty", v)}
              />
              <ColumnSelect
                label="Reference (optional)"
                headers={headers}
                value={mapping.externalRef}
                optional
                onChange={(v) => setMap("externalRef", v)}
              />
            </div>

            <fieldset className="mt-4 flex flex-col gap-2 text-sm">
              <legend className="font-medium text-text-secondary">
                Money in vs money out
              </legend>
              {DIRECTION_STRATEGIES.map((s) => (
                <label key={s.value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="direction-strategy"
                    checked={mapping.directionStrategy === s.value}
                    onChange={() => setMap("directionStrategy", s.value)}
                  />
                  <span className="text-text-primary">{s.label}</span>
                </label>
              ))}
              {mapping.directionStrategy === "column" && (
                <ColumnSelect
                  label="Debit / credit column"
                  headers={headers}
                  value={mapping.directionColumn}
                  optional
                  onChange={(v) => setMap("directionColumn", v)}
                />
              )}
            </fieldset>
          </div>

          <div className="rounded-card border border-border-subtle bg-surface p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Preview
              </p>
              <p className="text-xs text-text-muted">
                {normalized.rows.length} importable
                {normalized.skipped > 0
                  ? ` · ${normalized.skipped} will be skipped`
                  : ""}
              </p>
            </div>
            {normalized.rows.length === 0
              ? (
                <p className="mt-2 text-sm text-text-muted">
                  No rows could be read with this mapping. Check the date
                  format and which column holds the amount.
                </p>
              )
              : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-text-muted">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Date</th>
                        <th className="py-1 pr-3 font-medium">Counterparty</th>
                        <th className="py-1 pr-3 font-medium">Direction</th>
                        <th className="py-1 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {normalized.rows.slice(0, PREVIEW_LIMIT).map((r, i) => (
                        <tr
                          key={i}
                          className="border-t border-border-subtle text-text-primary"
                        >
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            {r.occurred_at.slice(0, 10)}
                          </td>
                          <td className="py-1.5 pr-3">
                            {r.counterparty ?? "—"}
                          </td>
                          <td className="py-1.5 pr-3">
                            {r.direction === "out" ? "Out" : r.direction === "in"
                              ? "In"
                              : "Neutral"}
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            {r.direction === "out" ? "−" : ""}
                            {formatRwf(r.amount_minor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {normalized.rows.length > PREVIEW_LIMIT && (
                    <p className="mt-1.5 text-xs text-text-muted">
                      …and {normalized.rows.length - PREVIEW_LIMIT} more
                    </p>
                  )}
                </div>
              )}
          </div>

          {actionError && (
            <p role="alert" className="text-sm text-attention">{actionError}</p>
          )}

          <button
            type="button"
            disabled={isPending || normalized.rows.length === 0}
            onClick={runImport}
            className="min-h-11 self-start rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {isPending
              ? "Importing…"
              : `Import ${normalized.rows.length} transaction${
                normalized.rows.length === 1 ? "" : "s"
              }`}
          </button>
        </>
      )}
    </div>
  );
}

function ColumnSelect({
  label,
  headers,
  value,
  optional = false,
  onChange,
}: {
  label: string;
  headers: string[];
  value: number | null;
  optional?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-text-secondary">{label}</span>
      <select
        value={value === null ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={INPUT_CLASS}
      >
        {optional && <option value="">Not in this file</option>}
        {headers.map((h, i) => (
          <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
        ))}
      </select>
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}
