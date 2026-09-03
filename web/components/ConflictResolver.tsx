"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyConflict,
  resolveConflict,
} from "../app/integrations/sync/actions";
import type { IntegrationConflict } from "../lib/integrations/destinations/model";

function display(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ConflictResolver({
  conflicts,
}: {
  conflicts: IntegrationConflict[];
}) {
  const router = useRouter();
  const [isPending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const result = await fn();
      if (result.ok) router.refresh();
      else alert(result.error ?? "Something went wrong.");
    });
  }

  return (
    <ul className="flex flex-col gap-3">
      {conflicts.map((c) => {
        const applicable = c.field === "category" || c.field === "description";
        return (
          <li key={c.id} className="rounded-card border border-border-subtle bg-surface p-4">
            <p className="text-sm font-medium text-text-primary">
              {c.field
                ? `${c.field} differs on a transaction`
                : "A row exists only in the workbook"}
            </p>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-control border border-border-subtle bg-background px-3 py-2">
                <span className="block text-xs text-text-muted">OneLedger</span>
                <span className="text-text-primary">{display(c.oneledgerValue)}</span>
              </div>
              <div className="rounded-control border border-border-subtle bg-background px-3 py-2">
                <span className="block text-xs text-text-muted">Workbook</span>
                <span className="text-text-primary">{display(c.externalValue)}</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => resolveConflict(c.id, "kept_oneledger"))}
                className="min-h-11 rounded-control border border-border-subtle bg-background px-3 text-sm font-medium disabled:opacity-50"
              >
                Keep OneLedger
              </button>
              {applicable && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => applyConflict(c.id))}
                  className="min-h-11 rounded-control bg-accent px-3 text-sm font-medium text-accent-foreground disabled:opacity-50"
                >
                  Accept workbook value
                </button>
              )}
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => resolveConflict(c.id, "ignored"))}
                className="min-h-11 rounded-control px-3 text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50"
              >
                Ignore
              </button>
            </div>
            {!applicable && (
              <p className="mt-2 text-xs text-text-muted">
                New rows are surfaced for awareness; import them through the Import
                Studio once column mapping for workbooks lands.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
