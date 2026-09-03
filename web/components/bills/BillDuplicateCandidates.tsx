"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "../Badge";
import { resolveBillDuplicate } from "../../app/bills/actions";
import type { BillDuplicateCandidateRow } from "../../lib/bills/queries";

// Possible-duplicate candidates for a document (Phase 4). Never
// auto-resolved: a bill.review holder picks keep-both / mark-duplicate /
// dismiss. Shows candidates in both directions (this document flagged
// against a prior one, and later documents flagged against this one).

const RELATION_LABEL: Record<string, string> = {
  exact: "Exact duplicate",
  probable: "Probable duplicate",
  multi_file: "Same expense, different file",
  recurring: "Looks like a recurring invoice",
  similar: "Similar document",
};

const RESOLUTION_LABEL: Record<string, string> = {
  unresolved: "",
  kept_both: "Kept both",
  merged: "Marked as duplicate",
  dismissed: "Dismissed",
};

export function BillDuplicateCandidates({
  documentId,
  candidates,
  canReview,
}: {
  documentId: string;
  candidates: BillDuplicateCandidateRow[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No possible duplicates found.
      </p>
    );
  }

  function resolve(id: string, resolution: "kept_both" | "merged" | "dismissed") {
    setError(null);
    startTransition(async () => {
      const res = await resolveBillDuplicate(id, resolution, documentId);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">
        These are checked, not confirmed. Nothing is merged or removed
        automatically.
      </p>
      <ul className="flex flex-col gap-3">
        {candidates.map((c) => (
          <li
            key={c.id}
            className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={c.relation === "recurring" ? "neutral" : "attention"}>
                {RELATION_LABEL[c.relation] ?? c.relation}
              </Badge>
              <span className="text-xs text-text-muted">
                {Math.round(c.score * 100)}% match · {c.signals.join(", ")}
              </span>
              {c.resolution !== "unresolved" && (
                <span className="text-xs font-medium text-text-secondary">
                  {RESOLUTION_LABEL[c.resolution]}
                </span>
              )}
            </div>
            <p className="text-sm text-text-secondary">
              {c.viewedIsSubject ? "Matches earlier document" : "Later document matches this one"}:{" "}
              <Link
                href={`/bills/${c.otherDocumentId}`}
                className="font-medium text-accent hover:underline"
              >
                {c.otherFilename ?? c.otherDocumentId}
              </Link>
            </p>
            {canReview && c.resolution === "unresolved" && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => resolve(c.id, "kept_both")}
                  className="min-h-11 rounded-control border border-border-strong px-3 text-sm font-medium text-text-primary disabled:opacity-50"
                >
                  Keep both
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => resolve(c.id, "merged")}
                  className="min-h-11 rounded-control border border-border-strong px-3 text-sm font-medium text-text-primary disabled:opacity-50"
                >
                  Mark as duplicate
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => resolve(c.id, "dismissed")}
                  className="min-h-11 rounded-control px-3 text-sm font-medium text-text-muted hover:text-text-primary disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </div>
  );
}
