"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { revealUtilityTokenAction } from "../app/transactions/token-actions";
import { unlinkReceiptAction } from "../app/transactions/receipts/actions";

const btn =
  "min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-semibold text-text-primary disabled:opacity-60";
const SHOW_SECONDS = 30;

// Shows a prepaid-electricity token only on request, for a short time, and
// holds it in component state only (never storage, never the URL).
export function UtilityTokenReveal({
  transactionId,
  kwh,
  canReveal,
  meterLast4,
  receiptId,
}: {
  transactionId: string;
  kwh: string | null;
  /** A token was kept and viewing is switched on. */
  canReveal: boolean;
  meterLast4: string | null;
  /** The linked receipt, so a wrong automatic match can be undone. */
  receiptId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          setToken(null);
          setCopied(false);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [token]);

  async function reveal() {
    setBusy(true);
    setError(null);
    const res = await revealUtilityTokenAction(transactionId);
    setBusy(false);
    if (res.ok) {
      setLeft(SHOW_SECONDS);
      setToken(res.token);
    } else setError(res.error);
  }

  return (
    <section
      aria-label="Electricity token"
      className="rounded-card border border-border-subtle bg-surface p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        Electricity token
      </p>
      {kwh ? <p className="mt-1 text-sm text-text-secondary">{kwh} kWh purchased</p> : null}
      {meterLast4 ? (
        <p className="mt-1 text-sm text-text-muted">Meter ending in {meterLast4}</p>
      ) : null}
      {canReveal ? (
        <p className="mt-1 text-sm text-text-muted">
          Anyone who has this token can use the electricity, so it is hidden until you ask. Each
          time you view it is recorded.
        </p>
      ) : (
        <p className="mt-1 text-sm text-text-muted">
          The token itself wasn&apos;t kept for this purchase.
        </p>
      )}
      {!canReveal ? null : token ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="select-all font-mono text-lg tracking-wider text-text-primary" aria-live="polite">
            {token}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btn}
              onClick={async () => {
                await navigator.clipboard.writeText(token.replace(/-/g, ""));
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className={btn} onClick={() => setToken(null)}>
              Hide
            </button>
            <span className="text-xs text-text-muted">Hides in {left}s</span>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy} className={`${btn} mt-3`} onClick={reveal}>
          {busy ? "Checking..." : "Show token"}
        </button>
      )}
      {receiptId ? (
        <button
          type="button"
          className="mt-3 text-sm font-medium text-accent hover:underline"
          onClick={async () => {
            const res = await unlinkReceiptAction(receiptId);
            if (res.ok) router.refresh();
            else setError(res.error);
          }}
        >
          Not this payment? Unlink the receipt
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-card border border-attention/30 bg-attention-bg p-3 text-sm text-attention">
          {error}
        </p>
      ) : null}
    </section>
  );
}
