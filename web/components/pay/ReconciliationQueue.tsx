"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "../Badge";
import { messages } from "../../lib/ussd/messages";
import { describeMatchedOn } from "../../lib/pay/state";
import { applyReconciliation, rejectReconciliation } from "../../app/pay/assisted-actions";

const t = messages().pay.assisted.recon;

type Candidate = {
  id: string;
  status: string;
  match_method: string;
  matched_on: Record<string, unknown>;
  intent: { id: string; recipient_name: string | null; amount_minor: number; currency: string };
  transaction: {
    id: string;
    occurred_at: string;
    amount_rwf: number;
    fee_rwf: number;
    counterparty_name: string | null;
  } | null;
};

type RequiresRow = {
  id: string;
  recipient_name: string | null;
  amount_minor: number;
  currency: string;
  created_at: string;
};

function fmt(minor: number, currency: string): string {
  const major = currency === "RWF" ? minor : minor / 100;
  return `${major.toLocaleString()} ${currency}`;
}

export function ReconciliationQueue({
  candidates,
  requiresReconciliation,
  observeMode,
}: {
  candidates: Candidate[];
  requiresReconciliation: RequiresRow[];
  observeMode: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(name: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(name);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  const empty = candidates.length === 0 && requiresReconciliation.length === 0;

  return (
    <div className="flex flex-col gap-5">
      {observeMode && (
        <p className="rounded-control bg-background px-3 py-2 text-xs text-text-secondary">
          {t.observeNote}
        </p>
      )}

      {empty && <p className="text-sm text-text-muted">{t.queueEmpty}</p>}

      {candidates.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-secondary">{t.likelyHeading}</h2>
          <ul className="flex flex-col gap-3">
            {candidates.map((c) => (
              <li key={c.id} className="rounded-card border border-border-subtle p-3">
                <div className="flex items-center gap-2">
                  <Badge variant={c.status === "conflict" ? "attention" : "neutral"}>
                    {c.status}
                  </Badge>
                  <Link
                    href={`/pay/${c.intent.id}`}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    {c.intent.recipient_name ?? "Payment"} ·{" "}
                    {fmt(c.intent.amount_minor, c.intent.currency)}
                  </Link>
                </div>
                {c.transaction && (
                  <p className="mt-1 text-sm text-text-secondary">
                    {c.transaction.counterparty_name ?? "Transaction"} ·{" "}
                    {fmt(
                      c.transaction.amount_rwf + c.transaction.fee_rwf,
                      c.intent.currency,
                    )}{" "}
                    · {new Date(c.transaction.occurred_at).toLocaleString()}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-text-muted">{describeMatchedOn(c.matched_on)}</p>
                <div className="mt-2 flex gap-2">
                  {c.status === "linked" && (
                    <button
                      type="button"
                      onClick={() => run(`apply-${c.id}`, () => applyReconciliation(c.id))}
                      disabled={busy !== null}
                      className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                    >
                      {busy === `apply-${c.id}` ? "…" : t.apply}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      run(`reject-${c.id}`, () => rejectReconciliation(c.id, "reviewed - not a match"))
                    }
                    disabled={busy !== null}
                    className="min-h-11 rounded-control px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50"
                  >
                    {t.reject}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {requiresReconciliation.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-secondary">
            {t.conflictHeading}
          </h2>
          <ul className="flex flex-col">
            {requiresReconciliation.map((r) => (
              <li key={r.id} className="border-b border-border-subtle py-2.5 last:border-b-0">
                <Link
                  href={`/pay/${r.id}`}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  {r.recipient_name ?? "Payment"} · {fmt(r.amount_minor, r.currency)}
                </Link>
                <span className="ml-2 text-xs text-text-muted">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="text-sm text-attention" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
