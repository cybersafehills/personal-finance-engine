"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  cancelPaymentRequestAction,
  linkPaymentRequestTransactionAction,
  markPaymentRequestPaidAction,
} from "../../app/pay/requests/actions";

const btn =
  "min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-semibold text-text-primary disabled:opacity-60";

export type Candidate = { id: string; when: string; who: string };

export function PaymentRequestActions({
  id,
  status,
  candidates,
}: {
  id: string;
  status: string;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<null | "cancel" | "paid">(null);

  // Cancel is still possible once expired (still stored as open); nothing else is.
  const canCancel = status === "open" || status === "expired";
  const canMark = status === "open";
  const canLink = status === "open" || status === "expired";
  if (!canCancel && !canMark && !canLink) return null;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    setConfirm(null);
    if (!res.ok) setError(res.error ?? "Something went wrong.");
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p role="alert" className="rounded-card border border-attention/30 bg-attention-bg p-3 text-sm text-attention">
          {error}
        </p>
      ) : null}

      {canLink ? (
        <section aria-labelledby="link-h" className="flex flex-col gap-2">
          <h2 id="link-h" className="text-sm font-semibold text-text-primary">Link the payment you received</h2>
          {candidates.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No settled incoming payment of exactly this amount has been recorded yet. Once
              OneLedger records it, it will appear here for you to confirm.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-card border border-border-subtle p-3 text-sm">
                  <span className="text-text-primary">
                    {c.who} <span className="text-text-muted">· {c.when}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    className={btn}
                    onClick={() => run(() => linkPaymentRequestTransactionAction(id, c.id))}
                  >
                    This is it
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {canMark ? (
        <section aria-labelledby="paid-h" className="flex flex-col gap-2">
          <h2 id="paid-h" className="text-sm font-semibold text-text-primary">Mark as paid yourself</h2>
          <p className="text-xs text-text-muted">
            Use this if you were paid some other way (e.g. cash). It records your own statement
            and is shown as &quot;marked paid by you&quot; - OneLedger does not verify it.
          </p>
          <input
            className="w-full rounded-control border border-border-subtle bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
          />
          {confirm === "paid" ? (
            <div className="flex gap-2">
              <button type="button" disabled={busy} className={btn} onClick={() => run(() => markPaymentRequestPaidAction(id, note))}>
                Yes, mark as paid
              </button>
              <button type="button" className={btn} onClick={() => setConfirm(null)}>Keep open</button>
            </div>
          ) : (
            <button type="button" className={`${btn} w-fit`} onClick={() => setConfirm("paid")}>Mark as paid</button>
          )}
        </section>
      ) : null}

      {canCancel ? (
        <section aria-labelledby="cancel-h" className="flex flex-col gap-2">
          <h2 id="cancel-h" className="text-sm font-semibold text-text-primary">Cancel this request</h2>
          <p className="text-xs text-text-muted">The link stops showing the payment details immediately.</p>
          {confirm === "cancel" ? (
            <div className="flex gap-2">
              <button type="button" disabled={busy} className={btn} onClick={() => run(() => cancelPaymentRequestAction(id))}>
                Yes, cancel it
              </button>
              <button type="button" className={btn} onClick={() => setConfirm(null)}>Keep open</button>
            </div>
          ) : (
            <button type="button" className={`${btn} w-fit`} onClick={() => setConfirm("cancel")}>Cancel request</button>
          )}
        </section>
      ) : null}
    </div>
  );
}
