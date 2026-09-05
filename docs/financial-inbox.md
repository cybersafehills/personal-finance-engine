# Financial Inbox

The Financial Inbox (`/inbox`) is the **single front door** for "what needs my
attention?" (assessment sections 33-35). It is a read/projection model
(`web/lib/financial-inbox.ts`) over OneLedger's existing resolution queues -
it never copies source data or holds a second workflow state. Every
specialized page (`/transactions/review`, `/pay/reconciliation`,
`/integrations/sync/conflicts`, `/bills/[id]`, ...) is a **drill-in from
here**, not a sibling in navigation. Inbox is now a primary nav destination
(ADR 0011).

## Sources

- transaction category review, including conflicting classifications
- possible-duplicate clusters
- household transactions awaiting attribution
- payment reconciliation candidates and conflicts, when the payment-intent
  surface is enabled for the active workspace
- canonical connector installations in `error`, `stale`, or overdue initial
  setup states, limited to installations the viewer can manage
- learned categorization-rule suggestions
- import batches needing review, and connected-workbook sync conflicts
- actionable active-budget alerts
- bills in `needs_review`, when `BILLS_ENABLED` and the viewer holds
  `bill.review`

If a transaction is already represented by a duplicate or attribution item,
its lower-priority category-review item is suppressed - one financial decision
never appears twice.

## Priority and ordering

Deterministic, fixed factor order (`buildFinancialInbox`, assessment section
35):

1. **severity** — `critical` before `high` before `normal`. Reconciliation
   conflicts and connector failures are critical; duplicates, attribution,
   stale connectors, categorization conflicts, imports needing review, bill
   review and *proposed* payment matches are high; routine confirmations and
   suggestions are normal.
2. **age** — older work first, so a stream of new arrivals never starves it.
3. **money at stake** — larger `financialImpactMinor` first, tie-break only.
4. **kind, then id** — stable final tie-breaks.

No arbitrary or model-ranked ordering. Reconciliation is a first-class lane
by virtue of its `critical` / `high` severity plus inline confirm/reject.

## Inline actions

The projection stays read-only; the **interactive layer**
(`web/components/InboxList.tsx`) only *dispatches* the authoritative domain
server action - the same one the drill-in surface uses - and then
optimistically drops the resolved item from the list. Each action re-checks
capability + scope + idempotency server-side; a failure leaves the item in
place with an inline error and the drill-in link intact.

| Inbox kind | Inline action(s) | Dispatches |
| --- | --- | --- |
| category review (non-conflict) | Confirm `<category>` / Dismiss | `confirm_transaction_category` / `dismiss_suggested_category` RPC |
| attribution | "This was mine" | `set_transaction_attribution` as `member` = current user |
| rule suggestion | Always `<category>` / Dismiss | `acceptLearnedSuggestion` / `dismissLearnedSuggestion` |
| duplicate — **clean 2-row cluster only** (1 open `possible_duplicate` + 1 keeper) | Merge / Not duplicates | `merge_duplicate_transaction` / `dismiss_possible_duplicate` RPC |
| reconciliation — **proposed match** (`status != conflict`) | Confirm match / Not a match | `apply_payment_reconciliation` / `reject_payment_reconciliation` RPC (`/pay/assisted-actions.ts`) |
| category conflict, ambiguous/large duplicate cluster, reconciliation conflict, connector health, imports, sync conflicts, budget, bill review | — (drill-in only) | multi-step decisions stay on their own surface |

Success and resolution counts are announced through an `aria-live` region;
every button carries `aria-busy` while its transition is pending.
