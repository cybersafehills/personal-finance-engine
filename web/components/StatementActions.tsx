"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteStatementAction,
  regenerateStatementAction,
} from "../app/reports/statements/actions";

// Detail-page actions for one statement. Downloads are plain links to the
// document route, which redirects to a short-lived signed URL with a
// Content-Disposition attachment name - no blob handling in the client.
// Regenerate / delete call the server actions; the library re-checks the
// flag and enforces the workspace + role gate.
export function StatementActions({
  statementUuid,
  status,
  canManage,
}: {
  statementUuid: string;
  status: "preparing" | "generating" | "ready" | "failed";
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, startRegenerate] = useTransition();
  const [isDeleting, startDelete] = useTransition();

  const docBase = `/api/reports/statements/${statementUuid}/document`;
  const ready = status === "ready";

  function regenerate() {
    setError(null);
    startRegenerate(async () => {
      const result = await regenerateStatementAction(statementUuid);
      if (result.ok) router.push(`/reports/statements/${result.id}`);
      else setError(result.message);
    });
  }

  function remove() {
    setError(null);
    if (!globalThis.confirm("Delete this statement? This can't be undone.")) {
      return;
    }
    startDelete(async () => {
      const result = await deleteStatementAction(statementUuid);
      if (result.ok) router.push("/reports/statements");
      else setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p
          role="alert"
          className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-sm text-attention"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {ready && (
          <a
            href={`${docBase}?format=pdf`}
            className="inline-flex min-h-11 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
          >
            Download PDF
          </a>
        )}
        {ready && (
          <a
            href={`${docBase}?format=csv`}
            className="inline-flex min-h-11 items-center rounded-control border border-border-subtle bg-background px-4 text-sm font-medium text-text-primary"
          >
            Download CSV
          </a>
        )}
        {canManage && (
          <button
            type="button"
            onClick={regenerate}
            disabled={isRegenerating || isDeleting}
            className="inline-flex min-h-11 items-center rounded-control border border-border-subtle bg-background px-4 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            {isRegenerating ? "Generating…" : "Generate updated version"}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={remove}
            disabled={isRegenerating || isDeleting}
            className="inline-flex min-h-11 items-center rounded-control border border-attention/30 bg-background px-4 text-sm font-medium text-attention disabled:opacity-50"
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}
