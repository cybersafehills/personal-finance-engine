// Payment-intent lifecycle - the client-side mirror of the Phase N
// `payment_intent_transition_allowed()` SQL function (user actor) plus
// the honest status vocabulary for the UI.
//
// Hard rule (docs/adr/0002-payment-intent-lifecycle.md): a handoff or a
// manual confirmation is NEVER shown as a verified success. `statusTone`
// returns "positive" only when `verified_at` is set - which, in Phase
// 2a, never happens (that's Phase 2b's SMS reconciliation).

export const PAYMENT_STATES = [
  "draft",
  "initiated",
  "awaiting_verification",
  "processing",
  "successful",
  "failed",
  "expired",
  "reversed",
  "requires_reconciliation",
  "cancelled",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<PaymentState> = new Set([
  "successful",
  "failed",
  "expired",
  "reversed",
  "cancelled",
]);

/** User-reachable transitions via `transition_payment_intent` (the
 *  `user` actor). `successful` is intentionally absent - it is reached
 *  only through `manually_confirm_payment` (2a) or system reconciliation
 *  (2b), never a plain transition. */
const USER_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  draft: ["initiated", "cancelled"],
  initiated: ["awaiting_verification", "failed", "expired", "cancelled"],
  awaiting_verification: ["failed", "expired", "cancelled"],
  processing: [],
  successful: [],
  failed: [],
  expired: [],
  reversed: [],
  requires_reconciliation: [],
  cancelled: [],
};

export function nextStates(from: PaymentState): PaymentState[] {
  return USER_TRANSITIONS[from] ?? [];
}

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return nextStates(from).includes(to);
}

export type IntentStatusInput = {
  state: string;
  verified_at?: string | null;
  manually_confirmed_at?: string | null;
};

export type StatusTone = "neutral" | "attention" | "positive";

export function statusLabel(intent: IntentStatusInput): string {
  switch (intent.state) {
    case "draft":
      return "Draft";
    case "initiated":
    case "awaiting_verification":
      return "Awaiting verification";
    case "processing":
      return "Processing";
    case "successful":
      if (intent.verified_at) return "Verified";
      if (intent.manually_confirmed_at) return "Manually confirmed";
      return "Completed";
    case "failed":
      return "Failed";
    case "expired":
      return "Expired";
    case "reversed":
      return "Reversed";
    case "requires_reconciliation":
      return "Needs reconciliation";
    case "cancelled":
      return "Cancelled";
    default:
      return intent.state;
  }
}

export function statusTone(intent: IntentStatusInput): StatusTone {
  if (intent.state === "successful" && intent.verified_at) return "positive";
  if (
    intent.state === "failed" ||
    intent.state === "reversed" ||
    intent.state === "expired" ||
    intent.state === "requires_reconciliation"
  ) {
    return "attention";
  }
  // draft, awaiting_verification, processing, cancelled, and a
  // manually-confirmed "successful" all read as neutral - never a
  // success colour without provider verification.
  return "neutral";
}

/** Human phrase for a payment_reconciliations.matched_on jsonb blob. */
export function describeMatchedOn(matchedOn: Record<string, unknown> | null | undefined): string {
  if (!matchedOn) return "";
  if (matchedOn.manual) return "you linked this manually";
  const parts: string[] = [];
  if (matchedOn.amount) parts.push("amount");
  if (matchedOn.msisdn) parts.push("phone number");
  if (matchedOn.time_window) parts.push("time");
  if (parts.length === 0) return "";
  const last = parts.pop()!;
  return `matched on ${parts.length ? parts.join(", ") + " and " : ""}${last}`;
}

/** A short, honest sentence describing what the status means. */
export function statusDescription(intent: IntentStatusInput): string {
  switch (statusLabel(intent)) {
    case "Draft":
      return "Not sent yet. Review and hand off to your provider when ready.";
    case "Awaiting verification":
      return "You've been handed off to your provider. OneLedger is waiting for evidence that the payment went through.";
    case "Manually confirmed":
      return "You told us this payment succeeded. OneLedger hasn't independently verified it.";
    case "Verified":
      return "Confirmed against provider evidence.";
    case "Failed":
      return "This payment didn't go through.";
    case "Expired":
      return "This draft or attempt timed out without confirmation.";
    case "Reversed":
      return "This payment was reversed.";
    case "Needs reconciliation":
      return "The evidence is unclear. Check the details before relying on this.";
    case "Cancelled":
      return "You cancelled this before handing off.";
    default:
      return "";
  }
}
