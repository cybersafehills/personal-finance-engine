"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmReceiptAction, ignoreReceiptAction } from "../app/transactions/receipts/actions";

const btn =
  "min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-semibold text-text-primary disabled:opacity-60";

export type ReceiptReviewData = {
  id: string;
  status: "unmatched" | "ambiguous";
  amountText: string;
  kwh: string;
  meterLast4: string | null;
  whenText: string;
  candidates: { id: string; whenText: string; who: string }[];
};

export function ReceiptReviewItem({ r }: { r: ReceiptReviewData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Something went wrong.");
  }

  return (
    <section className="rounded-card border border-border-subtle bg-surface p-4">
      <p className="text-sm font-medium text-text-primary">
        {r.amountText} for {r.kwh} kWh
      </p>
      <p className="text-xs text-text-muted">
        Receipt {r.whenText}
        {r.meterLast4 ? ` · meter ending ${r.meterLast4}` : ""}
      </p>
      <p className="mt-2 text-sm text-text-secondary">
        {r.status === "ambiguous"
          ? "More than one payment could match this receipt. Choose the right one."
          : r.candidates.length > 0
          ? "No payment matched automatically. If one of these is it, link it."
          : "Waiting for the MoMo payment. It will link by itself when the payment is recorded."}
      </p>
      {r.candidates.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {r.candidates.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-text-primary">
                {c.who} <span className="text-text-muted">· {c.whenText}</span>
              </span>
              <button type="button" disabled={busy} className={btn} onClick={() => run(() => confirmReceiptAction(r.id, c.id))}>
                This is it
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 rounded-card border border-attention/30 bg-attention-bg p-3 text-sm text-attention">
          {error}
        </p>
      ) : null}
      <button type="button" disabled={busy} className={`${btn} mt-3`} onClick={() => run(() => ignoreReceiptAction(r.id))}>
        Ignore this receipt
      </button>
    </section>
  );
}
