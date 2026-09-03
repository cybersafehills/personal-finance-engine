"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "./Badge";
import {
  connectWorkbook,
  disconnectWorkbook,
  setWorkbookStatus,
  syncWorkbookNow,
  uploadWorkbookFile,
} from "../app/integrations/sync/actions";
import { formatDateTime } from "../lib/format";
import {
  WORKBOOK_PROVIDER_LABEL,
  WORKBOOK_PROVIDERS,
} from "../lib/integrations/workbooks/contract";
import type { ConnectedWorkbook } from "../lib/integrations/destinations/model";

const DIRECTION_LABEL: Record<string, string> = {
  export: "OneLedger → workbook",
  import: "Workbook → OneLedger (review)",
  two_way: "Two-way (review inbound)",
};

export function WorkbookManager({
  workbooks,
}: {
  workbooks: ConnectedWorkbook[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<string>("manual_file");
  const [direction, setDirection] = useState<"export" | "import" | "two_way">(
    "export",
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await fn();
      if (result.ok) {
        if (ok) setNotice(ok);
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  function add() {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await connectWorkbook({ name, provider, direction });
      if (result.ok) {
        setName("");
        setAdding(false);
        setNotice(
          result.needsAuth
            ? "Workbook created. This provider isn’t available on this deployment yet."
            : "Workbook connected. Use “Sync now” to write your data.",
        );
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
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

      {workbooks.length === 0 ? (
        <p className="text-sm text-text-muted">No connected workbooks yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {workbooks.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">
                  {DIRECTION_LABEL[w.direction]}
                </span>
                <span className="block text-xs text-text-muted">
                  {w.lastSyncRunId ? `Last synced ${formatDateTime(w.updatedAt)}` : "Never synced"}
                  {w.externalRef && w.status === "active" ? " · file ready" : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant={w.status === "active" ? "positive" : w.status === "error" ? "attention" : "neutral"}>
                  {w.status}
                </Badge>
                <button type="button" disabled={isPending} onClick={() => run(() => syncWorkbookNow(w.id), "Sync started.")} className="rounded-control border border-border-subtle bg-background px-3 py-1 text-sm font-medium disabled:opacity-50">
                  Sync now
                </button>
                {w.direction !== "export" && (
                  <label className="rounded-control border border-border-subtle bg-background px-3 py-1 text-sm font-medium cursor-pointer">
                    Upload edited
                    <input
                      type="file"
                      accept=".xlsx"
                      className="sr-only"
                      disabled={isPending}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const data = new FormData();
                        data.set("file", file);
                        run(() => uploadWorkbookFile(w.id, data), "File uploaded — checking for changes.");
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
                {w.externalRef && (
                  <a href={`/api/integrations/workbooks/${w.id}`} className="text-sm font-medium text-accent hover:underline">
                    Download
                  </a>
                )}
                <button type="button" disabled={isPending} onClick={() => run(() => setWorkbookStatus(w.id, w.status === "paused" ? "active" : "paused"))} className="rounded-control border border-border-subtle bg-background px-3 py-1 text-sm font-medium disabled:opacity-50">
                  {w.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button type="button" disabled={isPending} onClick={() => run(() => disconnectWorkbook(w.id))} className="rounded-control px-3 py-1 text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50">
                  Disconnect
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workbook name"
            maxLength={80}
            className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
          />
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary">
            {WORKBOOK_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {WORKBOOK_PROVIDER_LABEL[p]}
                {p === "manual_file" ? "" : " (coming soon)"}
              </option>
            ))}
          </select>
          <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)} className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary">
            <option value="export">{DIRECTION_LABEL.export}</option>
            <option value="two_way">{DIRECTION_LABEL.two_way}</option>
            <option value="import">{DIRECTION_LABEL.import}</option>
          </select>
          <div className="flex gap-2">
            <button type="button" disabled={!name.trim() || isPending} onClick={add} className="min-h-11 rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50">
              {isPending ? "Connecting…" : "Connect workbook"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="min-h-11 rounded-control px-3 text-sm font-medium text-text-secondary hover:bg-background">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="min-h-11 self-start rounded-control border border-border-subtle bg-surface px-4 text-sm font-medium text-text-primary">
          Connect a workbook
        </button>
      )}
    </div>
  );
}
