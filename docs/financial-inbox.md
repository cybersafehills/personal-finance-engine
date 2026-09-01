# Financial Inbox read model

The Financial Inbox (`/inbox`) is a read-only projection over OneLedger's
existing resolution queues. It does not copy source data or introduce a second
workflow state. Every item links back to the source system that owns the
decision.

## Sources

- transaction category review, including conflicting classifications
- possible-duplicate clusters
- household transactions awaiting attribution
- payment reconciliation candidates and conflicts, when the payment-intent
  surface is enabled for the active workspace
- canonical connector installations in `error`, `stale`, or overdue initial
  setup states, limited to installations the viewer can manage
- learned categorization-rule suggestions
- actionable active-budget alerts

If a transaction is already represented by a duplicate or attribution item,
its lower-priority category-review item is suppressed. This keeps one financial
decision from appearing twice in the same workflow.

## Priority and ordering

Items use three explicit priorities: `critical`, `high`, and `normal`.
Reconciliation conflicts and connector failures are critical; duplicates,
attribution, stale connectors, and categorization conflicts are high; routine
confirmations and suggestions are normal. Within a priority, the oldest action
is shown first. Kind and stable source id provide deterministic tie-breakers.

The inbox performs no mutation. Existing RLS-scoped queries remain the access
boundary, provider rollout flags remain unchanged, and the deferred MTN canary
pairing is not required for this read model.
