"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminResolveReport } from "../../app/admin/ussd/actions";
import { Badge } from "../Badge";

const STATUSES = ["reviewing", "resolved", "dismissed"] as const;

export function AdminReportItem({
  report,
}: {
  report: {
    id: string;
    report_type: string;
    details: string | null;
    status: string;
    created_at: string;
    codeLabel: string;
    codeSlug: string | null;
  };
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(status: string) {
    setPending(status);
    setError(null);
    const res = await adminResolveReport(report.id, status, note);
    setPending(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <li className="border-b border-border-subtle py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="attention">{report.report_type.replace(/_/g, " ")}</Badge>
        <span className="font-medium text-text-primary">{report.codeLabel}</span>
        <span className="text-xs text-text-muted">
          {new Date(report.created_at).toLocaleDateString()}
        </span>
      </div>
      {report.details && (
        <p className="mt-1 text-sm text-text-secondary">{report.details}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Resolution note (optional)"
          className="min-w-48 flex-1 rounded-control border border-border-subtle bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
        />
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => resolve(s)}
            disabled={pending !== null}
            className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 py-1.5 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            {pending === s ? "…" : s}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-1 text-xs text-attention" role="status">
          {error}
        </p>
      )}
    </li>
  );
}
