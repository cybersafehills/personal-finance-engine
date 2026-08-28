"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBillCommentAction } from "../../app/bills/actions";
import { formatFullDateTime } from "../../lib/format";
import type { BillCommentRow } from "../../lib/bills/queries";

// Internal review notes (Phase 7). bill.review-gated on the server; the
// add form is hidden without it.

export function BillComments({
  documentId,
  comments,
  canComment,
}: {
  documentId: string;
  comments: BillCommentRow[];
  canComment: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {comments.length === 0 ? (
        <p className="text-sm text-text-muted">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-card border border-border-subtle bg-surface p-3">
              <p className="text-sm text-text-primary whitespace-pre-wrap">{c.body}</p>
              <p className="mt-1 text-xs text-text-muted">
                {c.mine ? "You" : "A reviewer"} · {formatFullDateTime(c.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await addBillCommentAction(documentId, body);
              if (res.ok) {
                setBody("");
                router.refresh();
              } else setError(res.error ?? "Couldn't add that note.");
            });
          }}
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Add a note for other reviewers…"
            className="rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
          />
          <button
            type="submit"
            disabled={isPending || body.trim().length === 0}
            className="min-h-11 w-fit rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {isPending ? "Adding…" : "Add note"}
          </button>
          {error && (
            <p role="alert" className="text-sm text-attention">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
