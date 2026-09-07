"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createStatementAction,
  previewStatementAction,
} from "../app/reports/statements/actions";
import type {
  StatementPreview,
  StatementRequest,
} from "../lib/statement-types";
import { REPORT_TIMEZONE_OPTIONS } from "../lib/timezones";
import {
  formatStatementAmount,
  formatStatementSignedAmount,
  statementDateKey,
} from "../lib/statement-document";

type SourceOption = { id: string; label: string; currency: string };

const PRESETS: { value: StatementRequest["preset"]; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_3_months", label: "Last 3 months" },
  { value: "last_6_months", label: "Last 6 months" },
  { value: "last_12_months", label: "Last 12 months" },
  { value: "custom", label: "Custom range…" },
];

const inputClass =
  "min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary";

function newToken(): string {
  return globalThis.crypto.randomUUID();
}

export function GenerateStatementFlow({
  sources,
  defaultTimezone,
}: {
  sources: SourceOption[];
  defaultTimezone: string;
}) {
  const router = useRouter();

  const [sourceMode, setSourceMode] = useState<"all" | "one">(
    sources.length === 1 ? "one" : "all",
  );
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [preset, setPreset] = useState<StatementRequest["preset"]>(
    "last_month",
  );
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statementType, setStatementType] = useState<"standard" | "detailed">(
    "standard",
  );
  const [direction, setDirection] = useState<"" | "in" | "out">("");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [showCustomize, setShowCustomize] = useState(false);

  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noTransactions, setNoTransactions] = useState(false);
  // Held so a double-click on Generate is idempotent; cleared on any edit
  // so a changed statement gets a fresh identity (not the deduped old one).
  const [token, setToken] = useState<string | null>(null);

  const [isPreviewing, startPreview] = useTransition();
  const [isGenerating, startGenerate] = useTransition();

  function onEdit<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPreview(null);
      setNoTransactions(false);
      setToken(null);
      setError(null);
    };
  }

  function buildRequest(clientToken: string): StatementRequest {
    return {
      statementType,
      preset,
      timezone,
      fromDateKey: preset === "custom" ? fromDate : undefined,
      toDateKey: preset === "custom" ? toDate : undefined,
      sourceIds: sourceMode === "one" && sourceId ? [sourceId] : [],
      filters: direction ? { direction } : undefined,
      clientToken,
    };
  }

  function validateLocal(): string | null {
    if (preset === "custom" && (!fromDate || !toDate)) {
      return "Choose both dates for a custom range.";
    }
    if (sourceMode === "one" && !sourceId) return "Choose an account.";
    return null;
  }

  function runPreview() {
    setError(null);
    setNoTransactions(false);
    const local = validateLocal();
    if (local) {
      setError(local);
      return;
    }
    startPreview(async () => {
      const result = await previewStatementAction(buildRequest(newToken()));
      if (result.ok) {
        setPreview(result.preview);
        setNoTransactions(result.preview.totals?.transactionCount === 0);
      } else {
        setPreview(null);
        setError(result.message);
      }
    });
  }

  function runGenerate() {
    setError(null);
    const t = token ?? newToken();
    setToken(t);
    startGenerate(async () => {
      const result = await createStatementAction(buildRequest(t));
      if (result.ok) {
        router.push(`/reports/statements/${result.id}`);
      } else {
        setToken(null);
        if (result.kind === "no_transactions") {
          setNoTransactions(true);
          setPreview(null);
        } else {
          setError(result.message);
        }
      }
    });
  }

  const currency = preview?.currency ?? sources[0]?.currency ?? "RWF";

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p
          role="alert"
          className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-sm text-attention"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-5 rounded-card border border-border-subtle bg-surface p-4">
        {/* Account */}
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-semibold text-text-primary">
            Account
          </legend>
          {sources.length > 0 && (
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="sourceMode"
                checked={sourceMode === "all"}
                onChange={() => onEdit(setSourceMode)("all")}
              />
              All accounts (consolidated)
            </label>
          )}
          <label className="flex flex-wrap items-center gap-2">
            {sources.length > 0 && (
              <input
                type="radio"
                name="sourceMode"
                checked={sourceMode === "one"}
                onChange={() => onEdit(setSourceMode)("one")}
              />
            )}
            <span className={sources.length === 0 ? "text-text-muted" : ""}>
              {sources.length === 0 ? "All accounts" : "A single account:"}
            </span>
            {sources.length > 0 && (
              <select
                value={sourceId}
                onChange={(e) => onEdit(setSourceId)(e.target.value)}
                disabled={sourceMode !== "one"}
                className={`${inputClass} disabled:opacity-50`}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}
          </label>
        </fieldset>

        {/* Period */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-primary">
            Statement period
          </span>
          <select
            value={preset}
            onChange={(e) =>
              onEdit(setPreset)(e.target.value as StatementRequest["preset"])}
            className={inputClass}
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        {preset === "custom" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text-primary">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => onEdit(setFromDate)(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text-primary">To</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => onEdit(setToDate)(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
        )}

        {/* Type */}
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-semibold text-text-primary">Type</legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="type"
              checked={statementType === "standard"}
              onChange={() => onEdit(setStatementType)("standard")}
            />
            <span>
              <span className="font-medium text-text-primary">Standard</span>
              <span className="block text-text-muted">
                Date, description, reference, money in / out, balance — like a
                conventional provider statement.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="type"
              checked={statementType === "detailed"}
              onChange={() => onEdit(setStatementType)("detailed")}
            />
            <span>
              <span className="font-medium text-text-primary">
                Detailed OneLedger
              </span>
              <span className="block text-text-muted">
                Adds OneLedger enrichment (category) alongside the original
                provider information.
              </span>
            </span>
          </label>
        </fieldset>

        {/* Customize */}
        <div className="border-t border-border-subtle pt-3 text-sm">
          <button
            type="button"
            onClick={() => setShowCustomize((v) => !v)}
            aria-expanded={showCustomize}
            className="min-h-11 font-medium text-accent"
          >
            {showCustomize ? "Hide options" : "Customize statement"}
          </button>
          {showCustomize && (
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-medium text-text-primary">
                  Scope{" "}
                  <span className="font-normal text-text-muted">
                    (a filtered statement is clearly marked as such)
                  </span>
                </span>
                <select
                  value={direction}
                  onChange={(e) =>
                    onEdit(setDirection)(e.target.value as "" | "in" | "out")}
                  className={inputClass}
                >
                  <option value="">All transactions</option>
                  <option value="in">Money in only</option>
                  <option value="out">Money out only</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-text-primary">Timezone</span>
                <select
                  value={timezone}
                  onChange={(e) => onEdit(setTimezone)(e.target.value)}
                  className={inputClass}
                >
                  {REPORT_TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={runPreview}
            disabled={isPreviewing || isGenerating}
            className="min-h-11 rounded-control border border-border-subtle bg-background px-4 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            {isPreviewing ? "Preparing preview…" : "Preview statement"}
          </button>
        </div>
      </div>

      {noTransactions && (
        <div className="rounded-card border border-border-subtle bg-surface p-4 text-sm">
          <p className="font-medium text-text-primary">
            No transactions were found for this account during the selected
            period.
          </p>
          <p className="mt-1 text-text-muted">
            Try a different period or account. A statement is only generated
            when there is activity to record.
          </p>
        </div>
      )}

      {preview && !noTransactions && (
        <PreviewCard
          preview={preview}
          currency={currency}
          onGenerate={runGenerate}
          isGenerating={isGenerating}
        />
      )}
    </div>
  );
}

function PreviewCard({
  preview,
  currency,
  onGenerate,
  isGenerating,
}: {
  preview: StatementPreview;
  currency: string;
  onGenerate: () => void;
  isGenerating: boolean;
}) {
  const t = preview.totals;
  const amount = (minor: number | null) =>
    minor === null ? "—" : formatStatementAmount(minor, currency);

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Statement preview
        </p>
        <p className="mt-1 text-sm font-medium text-text-primary">
          {preview.period.label}
        </p>
        <p className="text-xs text-text-muted">
          {t?.transactionCount ?? 0}{" "}
          {t?.transactionCount === 1 ? "transaction" : "transactions"}{" "}
          available ·{" "}
          {preview.statementType === "detailed" ? "Detailed" : "Standard"} ·
          {" "}
          {preview.scope === "filtered"
            ? "Filtered"
            : preview.scope === "all_accounts"
            ? "Consolidated"
            : "Single account"}
        </p>
        {preview.period.adjustments.map((a, i) => (
          <p key={i} className="mt-1 text-xs text-attention">{a}</p>
        ))}
      </div>

      {t && !preview.mixedCurrency && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Row label="Opening balance" value={amount(t.openingBalanceMinor)} />
          <Row
            label="Money in"
            value={formatStatementAmount(t.totalCreditsMinor, currency)}
          />
          <Row
            label="Money out"
            value={formatStatementAmount(t.totalDebitsMinor, currency)}
          />
          <Row
            label="Fees"
            value={formatStatementAmount(t.totalFeesMinor, currency)}
          />
          <Row
            label="Net movement"
            value={formatStatementSignedAmount(t.netMovementMinor, currency)}
          />
          <Row label="Closing balance" value={amount(t.closingBalanceMinor)} />
        </dl>
      )}
      {preview.mixedCurrency && (
        <p className="text-sm text-text-muted">
          This period spans multiple currencies — the document reports each
          currency separately and never combines them.
        </p>
      )}
      {t?.reconciles === false && (
        <p className="rounded-control bg-attention-bg px-3 py-2 text-xs text-attention">
          The balances don&apos;t reconcile against the transactions in this
          period — one or more may be missing from OneLedger&apos;s records. The
          statement will be generated with this noted.
        </p>
      )}

      <div className="text-xs text-text-muted">
        <p>{preview.coverage.statementLabel}</p>
        {preview.coverage.filtered && preview.coverage.filterSummary && (
          <p className="mt-1 font-medium text-text-secondary">
            Scope: {preview.coverage.filterSummary}
          </p>
        )}
        {preview.coverage.warnings.map((w, i) => (
          <p key={i} className="mt-1">• {w.detail}</p>
        ))}
      </div>

      {preview.sampleRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-xs">
            <thead className="text-text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Description</th>
                <th className="py-1 pr-2 text-right font-medium">In</th>
                <th className="py-1 pr-2 text-right font-medium">Out</th>
                <th className="py-1 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="text-text-secondary">
              {preview.sampleRows.map((r, i) => (
                <tr key={i} className="border-t border-border-subtle">
                  <td className="py-1 pr-2 tabular-nums">
                    {statementDateKey(r.occurredAt, preview.period.timezone)}
                  </td>
                  <td className="py-1 pr-2">{r.displayDescription}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.direction === "in"
                      ? formatStatementAmount(r.principalEffectMinor, currency)
                      : ""}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.direction === "out"
                      ? formatStatementAmount(r.principalEffectMinor, currency)
                      : ""}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {r.runningBalanceMinor === null
                      ? "—"
                      : formatStatementAmount(r.runningBalanceMinor, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.sampleTruncated && (
            <p className="mt-1 text-xs text-text-muted">
              Showing the first {preview.sampleRows.length} of{" "}
              {t?.transactionCount}{" "}
              — the full list is in the generated document.
            </p>
          )}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating}
          className="min-h-11 rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50"
        >
          {isGenerating ? "Generating…" : "Generate statement"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right tabular-nums text-text-primary">{value}</dd>
    </>
  );
}
