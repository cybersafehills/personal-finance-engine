// The live result of a payment you handed off, mirroring the web's payment page
// (web/components/pay/PaymentResultStatus.tsx): a spinner while we wait for the
// provider's own message, then a tick (sent) or a cross (didn't go through).
// Honest by construction: a tick shows only for the server's `successful` state,
// which is reached by the provider's message matching it or by you saying so;
// merely opening the dialer is never a tick (docs/adr/0002).

export type PayPhase = "waiting" | "success" | "failure";

const WAITING = new Set(["initiated", "awaiting_verification", "processing"]);
const FAILURE = new Set(["failed", "expired", "reversed"]);

/** How often the screen asks the server while a payment is waiting. */
export const POLL_MS = 4000;
/** After this long with no provider message, the person who dialled is asked. */
export const STALE_AFTER_MS = 90_000;

/** null = no live mark (a draft, a cancelled payment, or one needing reconciliation). */
export function payPhase(state: string): PayPhase | null {
  if (state === "successful") return "success";
  if (FAILURE.has(state)) return "failure";
  if (WAITING.has(state)) return "waiting";
  return null;
}

export type PhaseCopy = { title: string; body: string };

export function phaseCopy(
  phase: PayPhase,
  intent: { state: string; verified: boolean },
  amountLabel: string,
  recipient: string | null,
): PhaseCopy {
  const who = recipient ? ` to ${recipient}` : "";
  if (phase === "waiting") {
    return { title: "Waiting for confirmation", body: "Usually a few seconds. This updates by itself." };
  }
  if (phase === "success") {
    return intent.verified
      ? { title: "Money sent", body: `${amountLabel}${who} - confirmed by your provider.` }
      : { title: "Marked as sent", body: `${amountLabel}${who} - you confirmed this payment.` };
  }
  return {
    title: intent.state === "reversed" ? "Payment reversed" : "Payment didn't go through",
    body:
      intent.state === "expired"
        ? "No confirmation arrived in time. No money has been recorded as sent."
        : "No money was sent. You can try again.",
  };
}

/** Whether it has waited long enough that the person should be asked what happened. */
export function isStale(updatedAtIso: string, nowMs: number): boolean {
  const at = Date.parse(updatedAtIso);
  return Number.isFinite(at) && nowMs - at >= STALE_AFTER_MS;
}
