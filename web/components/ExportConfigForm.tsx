"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createExportJob,
  saveExportTemplate,
} from "../app/integrations/exports/actions";

type Account = { id: string; name: string; currency: string };
type Template = { id: string; name: string; config: Record<string, unknown> };
type Destination = { id: string; name: string };

const PRESETS: { value: string; label: string }[] = [
  { value: "previous_month", label: "Last month" },
  { value: "current_month", label: "This month" },
  { value: "previous_week", label: "Last week" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "fiscal_year", label: "Year to date" },
  { value: "all", label: "All time" },
  { value: "__custom", label: "Custom range…" },
];

const SHEETS = [
  "Summary",
  "Transactions",
  "Income",
  "Expenses",
  "Categories",
  "Accounts",
];

export function ExportConfigForm({
  accounts,
  templates,
  destinations = [],
}: {
  accounts: Account[];
  templates: Template[];
  destinations?: Destination[];
}) {
  const router = useRouter();
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const [destinationId, setDestinationId] = useState("");
  const [preset, setPreset] = useState("previous_month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accountIds, setAccountIds] = useState<Set<string>>(new Set());
  const [directions, setDirections] = useState<Set<string>>(new Set());
  const [sheets, setSheets] = useState<Set<string>>(new Set(SHEETS));
  const [templateName, setTemplateName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRunning, startRun] = useTransition();
  const [isSaving, startSave] = useTransition();

  function buildConfig() {
    const period = preset === "__custom"
      ? { kind: "absolute" as const, from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` }
      : { kind: "relative" as const, preset };
    return {
      format,
      period,
      accountIds: accountIds.size > 0 ? [...accountIds] : null,
      directions: directions.size > 0 ? [...directions] : null,
      sheets: format === "xlsx" ? [...sheets] : null,
    };
  }

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function loadTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const c = t.config as Record<string, unknown>;
    if (c.format === "csv" || c.format === "xlsx") setFormat(c.format);
    const period = c.period as Record<string, unknown> | undefined;
    if (period?.kind === "relative" && typeof period.preset === "string") {
      setPreset(period.preset);
    } else if (period?.kind === "absolute") {
      setPreset("__custom");
      setFrom(String(period.from ?? "").slice(0, 10));
      setTo(String(period.to ?? "").slice(0, 10));
    }
    setAccountIds(new Set(Array.isArray(c.accountIds) ? (c.accountIds as string[]) : []));
    setDirections(new Set(Array.isArray(c.directions) ? (c.directions as string[]) : []));
    if (Array.isArray(c.sheets)) setSheets(new Set(c.sheets as string[]));
    setNotice(`Loaded "${t.name}".`);
  }

  function generate() {
    setError(null);
    setNotice(null);
    if (preset === "__custom" && (!from || !to)) {
      setError("Choose both dates for a custom range.");
      return;
    }
    startRun(async () => {
      const result = await createExportJob(
        buildConfig(),
        null,
        destinationId || null,
      );
      if (result.ok) {
        setNotice(
          result.ran
            ? "Export ready — download it below."
            : "Large export queued — it will appear below when ready.",
        );
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function save() {
    setError(null);
    startSave(async () => {
      const result = await saveExportTemplate(templateName, buildConfig());
      if (result.ok) {
        setNotice(`Saved template "${templateName.trim()}".`);
        setTemplateName("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-5 rounded-card border border-border-subtle bg-surface p-4">
      {error && (
        <p role="alert" className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-sm text-attention">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-control border border-border-subtle bg-background px-3 py-2 text-sm text-text-secondary">
          {notice}
        </p>
      )}

      {templates.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-primary">Start from a template</span>
          <select
            defaultValue=""
            onChange={(e) => e.target.value && loadTemplate(e.target.value)}
            className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
          >
            <option value="">— none —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 font-semibold text-text-primary">Format</legend>
        {(["xlsx", "csv"] as const).map((f) => (
          <label key={f} className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              checked={format === f}
              onChange={() => setFormat(f)}
            />
            {f === "xlsx" ? "Excel workbook" : "CSV"}
          </label>
        ))}
      </fieldset>

      {destinations.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-primary">Deliver to</span>
          <select
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
            className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
          >
            <option value="">Download only</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-primary">Period</span>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      {preset === "__custom" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text-primary">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text-primary">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base" />
          </label>
        </div>
      )}

      {accounts.length > 0 && (
        <fieldset className="text-sm">
          <legend className="mb-1 font-semibold text-text-primary">
            Accounts <span className="font-normal text-text-muted">(all if none picked)</span>
          </legend>
          <div className="flex flex-wrap gap-3">
            {accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={accountIds.has(a.id)}
                  onChange={() => toggle(accountIds, setAccountIds, a.id)}
                />
                {a.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="text-sm">
        <legend className="mb-1 font-semibold text-text-primary">
          Direction <span className="font-normal text-text-muted">(both if none picked)</span>
        </legend>
        <div className="flex gap-4">
          {(["in", "out"] as const).map((d) => (
            <label key={d} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={directions.has(d)}
                onChange={() => toggle(directions, setDirections, d)}
              />
              {d === "in" ? "Money in" : "Money out"}
            </label>
          ))}
        </div>
      </fieldset>

      {format === "xlsx" && (
        <fieldset className="text-sm">
          <legend className="mb-1 font-semibold text-text-primary">Sheets</legend>
          <div className="flex flex-wrap gap-3">
            {SHEETS.map((s) => (
              <label key={s} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sheets.has(s)}
                  onChange={() => toggle(sheets, setSheets, s)}
                />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={isRunning}
          className="min-h-11 rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50"
        >
          {isRunning ? "Generating…" : "Generate export"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="Save this as… (e.g. Monthly accountant export)"
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
  );
}
