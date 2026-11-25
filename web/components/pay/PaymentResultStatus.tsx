"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { manuallyConfirm, markIntentFailed } from "../../app/pay/assisted-actions";

type Phase = "waiting" | "success" | "failure";

const WAITING_STATES = new Set(["initiated", "awaiting_verification", "processing"]);
const FAILURE_STATES = new Set(["failed", "expired", "reversed"]);
const POLL_MS = 4000;
/** After this long with no provider evidence, let the user settle it themselves. */
const STALE_AFTER_MS = 90_000;

function phaseOf(state: string): Phase | null {
  if (state === "successful") return "success";
  if (FAILURE_STATES.has(state)) return "failure";
  if (WAITING_STATES.has(state)) return "waiting";
  return null; // draft / cancelled / requires_reconciliation: no live mark
}

/**
 * Minimal live result for a hand-off payment: a spinning circle while we wait
 * for provider evidence, which resolves into a green tick (sent) or a red X
 * (didn't go through). Honest by construction - a tick is shown only for the
 * `successful` state (SMS-verified or confirmed by the user), never for a mere
 * hand-off (ADR 0002). While waiting it refreshes the server data every few
 * seconds, so the mark flips without a manual reload even if Realtime is down.
 */
export function PaymentResultStatus({
  intentId,
  since,
  state,
  verified,
  amountLabel,
  recipient,
}: {
  intentId: string;
  /** ISO time the intent last changed (hand-off time while waiting). */
  since: string;
  state: string;
  verified: boolean;
  amountLabel: string;
  recipient: string | null;
}) {
  const router = useRouter();
  const phase = phaseOf(state);
  const [stale, setStale] = useState(false);
  const [busy, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  // Waiting too long is not an answer: after a while, ask the person who
  // actually knows. (Evidence still wins - the next poll flips it by itself.)
  useEffect(() => {
    if (phase !== "waiting") return;
    const left = Date.parse(since) + STALE_AFTER_MS - Date.now();
    const t = setTimeout(() => setStale(true), Math.max(0, left));
    return () => clearTimeout(t);
  }, [phase, since]);

  const settle = (kind: "sent" | "failed") => {
    setActionError(null);
    startTransition(async () => {
      const res = kind === "sent"
        ? await manuallyConfirm(intentId, "Confirmed by me from the payment page")
        : await markIntentFailed(intentId, "Marked as not sent from the payment page");
      if (!res.ok) setActionError(res.error);
      else router.refresh();
    });
  };

  useEffect(() => {
    if (phase !== "waiting") return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [phase, router]);

  if (!phase) return null;

  const copy = {
    waiting: {
      title: "Waiting for confirmation",
      body: "Usually a few seconds. This page updates by itself.",
      color: "var(--color-accent, #f5c400)",
    },
    success: {
      title: verified ? "Money sent" : "Marked as sent",
      body: verified
        ? `${amountLabel}${recipient ? ` to ${recipient}` : ""} - confirmed by your provider.`
        : `${amountLabel}${recipient ? ` to ${recipient}` : ""} - you confirmed this payment.`,
      color: "#16a34a",
    },
    failure: {
      title: state === "reversed" ? "Payment reversed" : "Payment didn't go through",
      body:
        state === "reversed"
          ? "This payment was reversed. Check your provider balance before paying again."
          : state === "expired"
            ? "No confirmation arrived in time. No money has been recorded as sent. If money left your account, don't pay again until you've checked your provider messages."
            : "No money was sent. You can try again.",
      color: "#dc2626",
    },
  }[phase];

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="payment-result"
      data-phase={phase}
      className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-surface px-6 py-8 text-center"
    >
      <svg
        key={phase}
        width="72"
        height="72"
        viewBox="0 0 72 72"
        fill="none"
        stroke={copy.color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={phase === "waiting" ? undefined : "pay-mark-pop"}
        aria-hidden="true"
      >
        {phase === "waiting" ? (
          <>
            <circle cx="36" cy="36" r="30" opacity=".18" />
            <path className="pay-mark-spin" d="M36 6a30 30 0 0 1 30 30" />
          </>
        ) : (
          <>
            <circle className="pay-mark-ring" cx="36" cy="36" r="30" transform="rotate(-90 36 36)" />
            {phase === "success" ? (
              <path className="pay-mark-glyph" d="M22 37l10 10 18-21" />
            ) : (
              <path className="pay-mark-glyph" d="M25 25l22 22M47 25L25 47" />
            )}
          </>
        )}
      </svg>
      <p className="text-base font-semibold text-text-primary">{copy.title}</p>
      <p className="max-w-xs text-sm text-text-muted">{copy.body}</p>
      {phase === "waiting" && stale && (
        <div className="mt-2 flex w-full max-w-xs flex-col gap-2 border-t border-border-subtle pt-3">
          <p className="text-sm text-text-secondary">
            No confirmation yet. Did the payment go through on your phone?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => settle("sent")}
              className="min-h-11 flex-1 rounded-control bg-accent px-3 text-sm font-medium text-accent-foreground disabled:opacity-50"
            >
              Yes, it went through
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => settle("failed")}
              className="min-h-11 flex-1 rounded-control border border-border-strong px-3 text-sm font-medium text-text-primary disabled:opacity-50"
            >
              No
            </button>
          </div>
          {actionError && (
            <p role="alert" className="text-xs text-attention">{actionError}</p>
          )}
        </div>
      )}
    </div>
  );
}
