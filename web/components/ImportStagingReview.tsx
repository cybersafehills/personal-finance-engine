"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "./Badge";
import {
  commitImportBatch,
  rollbackImportBatch,
  setImportBatchTarget,
  setImportRecordsStatus,
} from "../app/integrations/imports/actions";
import type {
  ImportBatchStatus,
  ImportRecordStatus,
} from "../lib/integrations/model";

export type StagingRecord = {
  id: string;
  rowIndex: number;
  status: ImportRecordStatus;
  cells: string[];
  issues: { severity: string; message: string }[];
  matchConfidence: string | null;
};

export type StagingTargetSource = {
  id: string;
  displayName: string;
  provider: string;
  currency: string;
};

const FILTERS: { key: string; label: string; match: (s: ImportRecordStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "ready", label: "Ready", match: (s) => s === "ready" || s === "approved" },
  { key: "needs_review", label: "To review", match: (s) => s === "needs_review" || s === "possible_duplicate" },
  { key: "invalid", label: "Invalid", match: (s) => s === "invalid" },
  { key: "ignored", label: "Ignored", match: (s) => s === "ignored" },
  { key: "imported", label: "Imported", match: (s) => s === "imported" },
];

const STATUS_BADGE: Partial<
  Record<ImportRecordStatus, "neutral" | "attention" | "positive">
> = { ready: "positive", approved: "positive", imported: "positive", invalid: "attention" };

export function ImportStagingReview({
  batchId,
  batchStatus,
  headers,
  records,
  targetSources,
  currentSourceId,
}: {
  batchId: string;
  batchStatus: ImportBatchStatus;
  headers: string[];
  records: StagingRecord[];
  targetSources: StagingTargetSource[];
  currentSourceId: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sourceId, setSourceId] = useState(currentSourceId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    return records.filter((r) => f.match(r.status));
  }, [filter, records]);

  const readyCount = records.filter(
    (r) => r.status === "ready" || r.status === "approved",
  ).length;
  const invalidCount = records.filter((r) => r.status === "invalid").length;
  const selectable = visible.filter((r) => r.status !== "imported");
  const committed = batchStatus === "imported" || batchStatus === "rolled_back";

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await fn();
      if (result.ok) {
        setSelected(new Set());
        done?.();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  const bulk = (status: ImportRecordStatus) =>
    run(() => setImportRecordsStatus(batchId, [...selected], status));

  return (
    <div className="flex flex-col gap-4">
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

      {!committed && (
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-border-subtle bg-surface p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text-primary">Import into</span>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
            >
              <option value="">— choose an account —</option>
              {targetSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName} ({s.currency})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!sourceId || sourceId === currentSourceId || isPending}
            onClick={() => run(() => setImportBatchTarget(batchId, sourceId))}
            className="min-h-11 rounded-control border border-border-subtle bg-background px-4 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            Set account
          </button>
          {targetSources.length === 0 && (
            <p className="text-xs text-text-muted">
              Add a financial account first — an import must belong to one.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f.key
                ? "bg-accent text-accent-foreground"
                : "border border-border-subtle bg-surface text-text-secondary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!committed && selectable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() =>
              setSelected(new Set(selectable.map((r) => r.id)))}
            className="rounded-control px-2 py-1 font-medium text-accent hover:underline"
          >
            Select {selectable.length} shown
          </button>
          {selected.size > 0 && (
            <>
              <span className="text-text-muted">{selected.size} selected</span>
              <button type="button" onClick={() => bulk("approved")} disabled={isPending} className="rounded-control border border-border-subtle bg-surface px-3 py-1 font-medium">
                Approve
              </button>
              <button type="button" onClick={() => bulk("ignored")} disabled={isPending} className="rounded-control border border-border-subtle bg-surface px-3 py-1 font-medium">
                Ignore
              </button>
              <button type="button" onClick={() => bulk("ready")} disabled={isPending} className="rounded-control border border-border-subtle bg-surface px-3 py-1 font-medium">
                Re-open
              </button>
            </>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-border-subtle">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-background text-text-muted">
            <tr>
              {!committed && <th className="px-3 py-2" />}
              <th className="px-3 py-2 font-medium">Status</th>
              {headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                  {h || `Col ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, 200).map((r) => (
              <tr key={r.id} className="border-t border-border-subtle align-top">
                {!committed && (
                  <td className="px-3 py-1.5">
                    {r.status !== "imported" && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select row ${r.rowIndex + 1}`}
                      />
                    )}
                  </td>
                )}
                <td className="px-3 py-1.5">
                  <Badge variant={STATUS_BADGE[r.status] ?? "neutral"}>
                    {r.status.replace("_", " ")}
                  </Badge>
                  {r.issues.length > 0 && (
                    <ul className="mt-1 text-[11px] text-text-muted">
                      {r.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}
                    </ul>
                  )}
                </td>
                {headers.map((_, i) => (
                  <td key={i} className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                    {r.cells[i] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length > 200 && (
        <p className="text-xs text-text-muted">
          Showing the first 200 of {visible.length} rows.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
        {batchStatus === "validated" && (
          <button
            type="button"
            disabled={!currentSourceId || readyCount === 0 || isPending}
            onClick={() =>
              run(
                () => commitImportBatch(batchId),
                () => setNotice("Import committed."),
              )}
            className="min-h-11 rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50"
          >
            {isPending ? "Importing…" : `Import ${readyCount} ready ${readyCount === 1 ? "row" : "rows"}`}
          </button>
        )}
        {batchStatus === "imported" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              run(async () => {
                const res = await rollbackImportBatch(batchId);
                if (res.ok) {
                  setNotice(
                    res.complete
                      ? `Undone — ${res.removed} transactions removed.`
                      : `${res.removed} removed, ${res.retained} kept (edited, merged, or used elsewhere).`,
                  );
                }
                return res;
              })}
            className="min-h-11 rounded-control border border-border-subtle bg-background px-4 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            {isPending ? "Undoing…" : "Undo import"}
          </button>
        )}
        {batchStatus === "rolled_back" && (
          <button
            type="button"
            disabled={!currentSourceId || isPending}
            onClick={() =>
              run(
                () => commitImportBatch(batchId),
                () => setNotice("Re-imported."),
              )}
            className="min-h-11 rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50"
          >
            Re-import
          </button>
        )}
        {!currentSourceId && batchStatus === "validated" && (
          <span className="text-xs text-text-muted">Choose an account above to import.</span>
        )}
        {invalidCount > 0 && (
          <a
            href={`/api/integrations/imports/${batchId}/errors`}
            className="text-sm font-medium text-accent hover:underline"
          >
            Download {invalidCount} invalid {invalidCount === 1 ? "row" : "rows"}
          </a>
        )}
      </div>
    </div>
  );
}
