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
};

/**
 * A state's label. The app never shows a success state: whether a payment went
 * through is only ever established by evidence on the web, so any state it does
 * not recognise reads as neutral progress, never as a tick.
 */
export function stateLabel(state: string): string {
  return LABELS[state] ?? "In progress";
}
