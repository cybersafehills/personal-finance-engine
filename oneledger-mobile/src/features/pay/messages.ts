// Wording mirrors the web review screen (web/lib/ussd/messages.ts) so the two
// say the same thing about who authorises a payment.

export const PAY_COPY = {
  reviewTitle: "Review before you continue",
  handoffNotice:
    "Authorization happens with your provider, on your own phone. OneLedger never asks for your Mobile Money or banking PIN, and can't send money on your behalf.",
  feeNotice: "Your provider will show the final fee before you approve.",
  noRoute:
    "We don't have a verified USSD route for this payment yet, so there's nothing to dial from here.",
  iosHint: "On iPhone, share or copy the code, then dial it in the Phone app.",
  afterHandoff:
    "Opening the dialer or copying the code isn't proof of payment. OneLedger only marks a payment confirmed when it sees matching evidence.",
  dialerFailed: "Couldn't open the dialer. Share or copy the code and dial it yourself.",
} as const;

const LABELS: Record<string, string> = {
  draft: "Draft",
  initiated: "Handed off",
  awaiting_verification: "Awaiting verification",
  expired: "Expired",
  cancelled: "Cancelled",
  failed: "Didn't work",
  processing: "Processing",
  reversed: "Reversed",
  requires_reconciliation: "Needs reconciliation",
};

/** What to say for a payment that has no live result and must not be dialled. */
export function closedNotice(state: string): string {
  if (state === "requires_reconciliation") {
    return "The evidence doesn't match this payment. Don't pay again until you've checked your provider messages. You can resolve it on the web.";
  }
  if (state === "cancelled") return "This payment was cancelled. If you still need to send it, start a new one from Pay.";
  return "Check where this payment stands on the web before paying again.";
}

/** What stands behind a `successful` payment. Mirrors web/lib/pay/state.ts#statusLabel. */
export type PaymentEvidence = { verified?: boolean; manuallyConfirmed?: boolean };

/**
 * A state's label. "Verified" only with the provider's own evidence; a payment you
 * confirmed yourself says so (docs/adr/0002). A state the app does not recognise
 * reads as neutral progress.
 */
export function stateLabel(state: string, evidence: PaymentEvidence = {}): string {
  if (state === "successful") {
    if (evidence.verified) return "Verified";
    return evidence.manuallyConfirmed ? "Manually confirmed" : "Completed";
  }
  return LABELS[state] ?? "In progress";
}
