// Maps database error codes (raised by the console_* functions) to messages a
// staff member can act on. Unknown errors become a generic message; the raw
// database text is never shown.
const MESSAGES: Record<string, string> = {
  not_authorized: "Your role does not allow this action.",
  mfa_required: "Your session needs multi-factor verification again. Sign in and verify.",
  not_found: "That record no longer exists.",
  invalid_transition: "That status change is not allowed from the current status.",
  note_required: "A short note is required for this change.",
  empty_note: "The note cannot be empty.",
  invalid_assignee: "That person cannot take support tickets.",
  customer_not_found: "No customer with that reference.",
  invalid_status: "That status is not valid.",
  invalid_kind: "That option is not valid.",
  reason_required: "Give a reason of at least 10 characters.",
  target_not_found: "No account exists with that email. They must sign up in the customer app first.",
  cannot_target_self: "You cannot request a change to your own access.",
  already_staff: "That person already has console access.",
  not_staff: "That person does not have console access.",
  already_suspended: "That person is already suspended.",
  already_active: "That person is already active.",
  already_pending: "A request for that change is already waiting for a decision.",
  not_pending: "This request has already been decided.",
  not_requester: "Only the person who made the request can cancel it.",
  self_approval_forbidden: "You cannot approve a request you made. A different owner must decide it.",
  cannot_decide_own_access: "You cannot decide a request about your own access.",
  invalid_decision: "That decision is not valid.",
};

export const FAILURE_REASONS: Record<string, string> = {
  target_no_longer_exists: "The account no longer exists.",
  target_already_staff: "The person already had access when this was approved.",
  target_not_staff: "The person no longer has console access.",
  target_already_suspended: "The person was already suspended.",
  target_already_active: "The person was already active.",
  would_remove_last_owner: "Blocked: this would leave the console with no active Platform Owner.",
  role_unchanged: "The person already has that role.",
};

export function friendlyError(message: string | undefined | null): string {
  const m = message ?? "";
  for (const key of Object.keys(MESSAGES)) if (m.includes(key)) return MESSAGES[key];
  if (m.includes("violates check constraint")) return "One of the values is not valid. Check the fields and try again.";
  return "Something went wrong. Nothing was changed; try again.";
}
