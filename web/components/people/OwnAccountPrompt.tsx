"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setOwnAccountAction } from "../../app/people/actions";
import { SELF_EXPLANATION } from "../../lib/counterparties/directory";
import { formatRwf } from "../../lib/format";

export type OwnAccountPromptItem = {
  id: string;
  name: string;
  reason: string;
  receivedRwf: number;
  sentRwf: number;
  txnCount: number;
};

/**
 * "Is this you?" - a short list of names that may be the user's own accounts, each
 * with a one-tap "This is me" (and Undo). Marking one removes its transactions from
 * income, spending, budgets and the forecast; nothing is marked without a tap.
 */
export function OwnAccountPrompt({
  title,
  intro,
  items,
}: {
  title: string;
  intro: string;
  items: OwnAccountPromptItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function set(id: string, mine: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setOwnAccountAction(id, mine);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMarked((prev) => {
        const next = new Set(prev);
        if (mine) next.add(id);
        else next.delete(id);
        return next;
      });
      router.refresh();
    });
  }

  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <p className="text-xs text-text-secondary">{intro}</p>
        <p className="text-xs text-text-muted">{SELF_EXPLANATION}</p>
      </div>
      {error ? <p role="alert" className="text-sm text-attention">{error}</p> : null}
      <ul className="flex flex-col divide-y divide-border-subtle">
        {items.map((it) => {
          const done = marked.has(it.id);
          return (
            <li key={it.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 flex-col">
                <Link href={`/people/${it.id}`} className="truncate text-sm font-medium text-text-primary hover:underline">
                  {it.name}
                </Link>
                <span className="text-xs text-text-muted">
                  {it.reason} · {it.txnCount} {it.txnCount === 1 ? "transaction" : "transactions"}
                  {it.receivedRwf > 0 ? ` · received ${formatRwf(it.receivedRwf)}` : ""}
                  {it.sentRwf > 0 ? ` · sent ${formatRwf(it.sentRwf)}` : ""}
                </span>
              </span>
              {done
                ? (
                  <span className="flex items-center gap-3 text-sm">
                    <span role="status" className="text-text-secondary">Marked as your account</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => set(it.id, false)}
                      className="min-h-11 font-medium text-accent hover:underline disabled:opacity-60"
                    >
                      Undo
                    </button>
                  </span>
                )
                : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => set(it.id, true)}
                    className="min-h-11 rounded-control border border-border-subtle px-3 py-2 text-sm font-semibold text-text-primary hover:border-accent disabled:opacity-60"
                  >
                    This is me
                  </button>
                )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
