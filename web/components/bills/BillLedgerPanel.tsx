"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "../Badge";
import {
  approveBillAction,
  postBillAction,
  unlinkBillTransactionAction,
} from "../../app/bills/actions";
import type {
  BillLedgerBundle,
  BillDocumentStatus,
} from "../../lib/bills/queries";

// Approve -> (match transactions | post as unpaid) -> ledger summary
// (Phase 6). The document that pays an existing transaction is LINKED,
// never turned into a second expense.

function money(minor: number | null, currency: string | null): string {
  if (minor == null) return "—";
  const digits = currency && ["RWF", "UGX", "TZS", "JPY", "BIF", "XAF", "XOF"].includes(currency) ? 0 : 2;
  return `${currency ? currency + " " : ""}${(minor / 10 ** digits).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function shortDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

export function BillLedgerPanel({
  documentId,
  status,
  ledger,
  canApprove,
  canPost,
  canReview,
}: {
  documentId: string;
  status: BillDocumentStatus;
  ledger: BillLedgerBundle;
  canApprove: boolean;
  canPost: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { bill, links, candidates } = ledger;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error ?? "Something went wrong.");
    });
  }

  // --- posted / matched: the ledger summary --------------------------
  if (bill && bill.posted_at) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="positive">{status === "matched" ? "Matched" : "Posted"}</Badge>
          <span className="text-text-primary">
            {money(bill.total_minor, bill.currency)} · {bill.paid_state}
          </span>
          <span className="text-text-muted">approved {shortDate(bill.approved_at)}</span>
        </div>
        {links.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {links.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span className="text-text-secondary">
                  {shortDate(l.occurredAt)} · {money(l.amountMinor, l.currency)} ·{" "}
                  {l.counterparty ?? "—"}
                </span>
                {canReview && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => unlinkBillTransactionAction(l.id, documentId))}
                    className="min-h-11 rounded-control px-2 text-xs font-medium text-text-muted hover:text-text-primary"
                  >
                    Unlink
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">
            Posted as an unpaid bill — no transaction is linked yet.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-attention">
            {error}
          </p>
        )}
      </div>
    );
  }

  // --- approved, not yet posted: match + post ------------------------
  if (bill && !bill.posted_at) {
    if (!canPost) {
      return (
        <p className="text-sm text-text-muted">
          Approved ({money(bill.total_minor, bill.currency)}). Waiting for someone with
          posting permission to link a payment or post it as unpaid.
        </p>
      );
    }
    const ids = [...selected];
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-primary">
          Approved · {money(bill.total_minor, bill.currency)}. Link the payment(s) or post
          as an unpaid bill.
        </p>
        {candidates.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {candidates.map((c) => (
              <li key={c.id} className="rounded-card border border-border-subtle bg-surface p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(c.transaction_id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(c.transaction_id);
                      else next.delete(c.transaction_id);
                      setSelected(next);
                    }}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-text-primary">
                      {shortDate(c.occurredAt)} · {money(c.amountMinor, c.currency)} ·{" "}
                      {c.counterparty ?? "—"}
                      <span className="ml-1 text-xs text-text-muted">
                        {Math.round(c.score * 100)}% match
                      </span>
                    </span>
                    {c.reasons_for.length > 0 && (
                      <span className="text-xs text-money-positive">
                        For: {c.reasons_for.join(", ")}
                      </span>
                    )}
                    {c.reasons_against.length > 0 && (
                      <span className="text-xs text-attention">
                        Against: {c.reasons_against.join(", ")}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No matching transactions were found.</p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isPending || ids.length === 0}
            onClick={() => run(() => postBillAction(documentId, ids))}
            className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {isPending ? "Posting…" : `Link ${ids.length || ""} & post`}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => postBillAction(documentId, [], "unpaid"))}
            className="min-h-11 rounded-control border border-border-strong px-4 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            Post as unpaid bill
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-attention">
            {error}
          </p>
        )}
      </div>
    );
  }

  // --- not yet approved --------------------------------------------
  if (status !== "needs_review" && status !== "under_review") {
    return (
      <p className="text-sm text-text-muted">
        This document isn&rsquo;t ready to approve.
      </p>
    );
  }
  if (!canApprove) {
    return (
      <p className="text-sm text-text-muted">
        You don&rsquo;t have permission to approve documents.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Note (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(() => approveBillAction(documentId, { notes }))}
        className="min-h-11 w-fit rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Approving…" : "Approve"}
      </button>
      <p className="text-xs text-text-muted">
        Approving creates the bill record. It still needs posting (with or without a linked
        payment) before it reaches the ledger.
      </p>
      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </div>
  );
}
