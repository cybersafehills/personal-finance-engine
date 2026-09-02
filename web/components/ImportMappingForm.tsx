"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyImportMapping,
  saveImportTemplate,
} from "../app/integrations/imports/actions";
import {
  type AmountMode,
  type DirectionMode,
  type ImportColumnMapping,
  isMappingComplete,
  missingRequiredFields,
  normalizeImportRow,
} from "../lib/integrations/mapping";
import type { CanonicalImportField } from "../lib/integrations/model";

const SIMPLE_FIELDS: { field: CanonicalImportField; label: string; hint?: string }[] = [
  { field: "date", label: "Date", hint: "Required" },
  { field: "description", label: "Description" },
  { field: "merchant", label: "Merchant / payee" },
  { field: "external_reference", label: "Reference" },
  { field: "external_transaction_id", label: "Transaction ID" },
  { field: "balance", label: "Running balance" },
  { field: "currency", label: "Currency" },
  { field: "category", label: "Category" },
];

const AMOUNT_MODES: { value: AmountMode; label: string }[] = [
  { value: "signed", label: "One amount column (− = money out)" },
  { value: "split", label: "Separate money-in / money-out columns" },
  { value: "all_out", label: "Every row is money out" },
  { value: "all_in", label: "Every row is money in" },
];

export function ImportMappingForm({
  batchId,
  headers,
  sampleRows,
  initialMapping,
  matchedTemplateName,
}: {
  batchId: string;
  headers: string[];
  sampleRows: string[][];
  initialMapping: ImportColumnMapping;
  matchedTemplateName?: string | null;
}) {
  const router = useRouter();
  const [mapping, setMapping] = useState<ImportColumnMapping>(initialMapping);
  const [templateName, setTemplateName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    matchedTemplateName ? `Pre-filled from template "${matchedTemplateName}".` : null,
  );
  const [isApplying, startApply] = useTransition();
  const [isSaving, startSave] = useTransition();

  const missing = missingRequiredFields(mapping);
  const complete = isMappingComplete(mapping);

  const sampleResult = useMemo(() => {
    if (!complete) return null;
    let parsed = 0;
    for (const cells of sampleRows) {
      if (normalizeImportRow(cells, mapping).ok) parsed += 1;
    }
    return { parsed, total: sampleRows.length };
  }, [mapping, sampleRows, complete]);

  function setColumn(field: CanonicalImportField, value: string) {
    setMapping((prev) => {
      const columns = { ...prev.columns };
      if (value === "") delete columns[field];
      else columns[field] = Number(value);
      return { ...prev, columns };
    });
  }

  function columnSelect(field: CanonicalImportField, label: string, hint?: string) {
    return (
      <label key={field} className="flex flex-col gap-1">
        <span className="text-sm font-medium text-text-primary">
          {label}
          {hint && (
            <span className="ml-1.5 text-xs font-normal text-text-muted">
              {hint}
            </span>
          )}
        </span>
        <select
          value={mapping.columns[field] ?? ""}
          onChange={(e) => setColumn(field, e.target.value)}
          className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
        >
          <option value="">— not mapped —</option>
          {headers.map((h, i) => (
            <option key={i} value={i}>
              {h || `Column ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function apply() {
    setError(null);
    setNotice(null);
    startApply(async () => {
      const result = await applyImportMapping(batchId, mapping);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function save() {
    setError(null);
    startSave(async () => {
      const result = await saveImportTemplate(batchId, templateName);
      if (result.ok) {
        setNotice(`Saved template "${templateName.trim()}".`);
        setTemplateName("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <p className="rounded-control border border-border-subtle bg-background px-3 py-2 text-sm text-text-secondary">
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-sm text-attention"
        >
          {error}
        </p>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-text-primary">
          Amount
        </legend>
        {AMOUNT_MODES.map((mode) => (
          <label key={mode.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="amountMode"
              checked={mapping.amountMode === mode.value}
              onChange={() =>
                setMapping((p) => ({ ...p, amountMode: mode.value }))}
            />
            {mode.label}
          </label>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          {mapping.amountMode === "split" ? (
            <>
              {columnSelect("inflow", "Money in column")}
              {columnSelect("outflow", "Money out column")}
            </>
          ) : (
            columnSelect("amount_signed", "Amount column", "Required")
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-text-primary">
          Direction
        </legend>
        {([
          ["from_amount", "Infer from the amount"],
          ["column", "Use a dedicated in/out column"],
        ] as [DirectionMode, string][]).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="directionMode"
              checked={mapping.directionMode === value}
              onChange={() =>
                setMapping((p) => ({ ...p, directionMode: value }))}
            />
            {label}
          </label>
        ))}
        {mapping.directionMode === "column" &&
          columnSelect("direction", "Direction column", "Required")}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        {SIMPLE_FIELDS.map(({ field, label, hint }) =>
          columnSelect(field, label, hint)
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-primary">
            Date format
          </span>
          <select
            value={mapping.dateOrder}
            onChange={(e) =>
              setMapping((p) => ({
                ...p,
                dateOrder: e.target.value as ImportColumnMapping["dateOrder"],
              }))}
            className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
          >
            <option value="dmy">Day first (31/01/2026)</option>
            <option value="mdy">Month first (01/31/2026)</option>
            <option value="iso">ISO (2026-01-31)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-primary">
            Default currency
          </span>
          <input
            value={mapping.defaultCurrency ?? ""}
            onChange={(e) =>
              setMapping((p) => ({
                ...p,
                defaultCurrency: e.target.value.toUpperCase().trim() || null,
              }))}
            placeholder="RWF"
            maxLength={3}
            className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
          />
        </label>
      </div>

      <div className="rounded-card border border-border-subtle bg-surface p-4 text-sm">
        {missing.length > 0 ? (
          <p className="text-text-secondary">
            Still needed: <span className="font-medium">{missing.join(", ")}</span>
          </p>
        ) : sampleResult ? (
          <p className="text-text-secondary">
            {sampleResult.parsed} of {sampleResult.total} sample rows parse with
            this mapping.
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={apply}
        disabled={!complete || isApplying}
        className="min-h-11 rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50"
      >
        {isApplying ? "Validating…" : "Apply mapping and validate"}
      </button>

      <div className="border-t border-border-subtle pt-4">
        <p className="mb-2 text-sm font-semibold text-text-primary">
          Save this mapping as a template
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="e.g. BK business account CSV"
            maxLength={80}
            className="min-h-11 flex-1 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
          />
          <button
            type="button"
            onClick={save}
            disabled={!templateName.trim() || isSaving}
            className="min-h-11 rounded-control border border-border-subtle bg-background px-4 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </div>
  );
}
