# ADR 0003: SMS reconciliation links, never inserts; deterministic before probabilistic

- **Status:** Accepted
- **Date:** 2026-08-27
- **Context:** Pay & Services Phase 2b. Builds on ADR 0001 (non-custodial) and 0002 (intent lifecycle).

## Decision

When the Mobile Money SMS for a handed-off Assisted Quick Pay payment is
ingested by `supabase/functions/ingest-momo` and becomes a `transactions`
row, Phase 2b **links that existing row to its `payment_intent`** and
advances the intent to `verified`. It does this and only this:

1. **Never creates a second ledger transaction.** The ingestion pipeline
   already made the one authoritative row. Reconciliation writes a
   `payment_reconciliations` link, sets `payment_intents.linked_transaction_id`
   + `verified_at`, and transitions the intent to `successful` via the
   `system`/`ingestion` actor (`system_transition_payment_intent`, the only
   path to `successful`/`requires_reconciliation`/`reversed`).

2. **Deterministic before probabilistic.** A match requires an exact
   agreement on: workspace, `direction='out'` + `status='success'` +
   `currency='RWF'`, `amount_minor == amount_rwf`, normalized recipient
   MSISDN (`normalize_rw_msisdn` — a hand-maintained SQL mirror of
   `web/lib/pay/phone.ts` and `_shared/payment-reconciliation.ts`),
   provider ↔ source, and `occurred_at` inside `[intent.created_at − 10m,
   intent.expires_at]`. No fuzzy scoring, no ML, no "closest" guess.

3. **Ambiguity is a conflict, not a coin flip.** If ≥ 2 open intents
   match one transaction, each gets a `status='conflict'`
   `payment_reconciliations` row and (in apply mode) goes to
   `requires_reconciliation`. A human resolves it on `/pay/reconciliation`
   or by manually linking the right transaction.

4. **The intent's category lands on the transaction as a review-queue
   suggestion**, never a commit: `suggested_category` +
   `category_decision_status='suggested'`, with a
   `transaction_category_history` row (`actor_type='system'`,
   `engine_version='payment-reconciliation@1'`). It is applied **only**
   when the transaction is `uncategorized`/`suggested` and its
   `category_source` is not `'manual'` — so a rule/auto/provisional/
   confirmed/manual decision is never overwritten. This honours the
   existing decision hierarchy: **direct evidence outranks user
   policies**, and manual corrections are preserved.

5. **Ships observe-only.** `SMS_RECONCILIATION_ENABLED` is opt-in
   (`=== "true"`). `SMS_RECONCILIATION_MODE` defaults to `observe`:
   candidate links are recorded for accuracy review on
   `/pay/reconciliation` but the intent and ledger are untouched. After
   review, flip to `apply`.

## Why

- Inserting a transaction here would create a duplicate expense the
  moment the SMS also ingests — the exact failure the master prompt
  forbids ("Never create a second ledger expense when an SMS matches an
  existing payment intent").
- Deterministic-only keeps a wrong link impossible-by-construction rather
  than merely unlikely. A missed match is recoverable (manual link, retry
  cron); a wrong auto-link that verifies a payment is not.
- `suggested` (not `provisional`/`confirmed`) means the reconciliation
  never silently changes what a transaction is categorized as.

## Consequences

- The authoritative matcher is 100% SQL
  (`reconcile_transaction_with_payment_intents`, `service_role` only). The
  pure `_shared/payment-reconciliation.ts` is the unit-tested rule
  reference; the two are kept in sync by hand (the sanctioned pattern —
  see `docs/categorization-engine.md`).
- `reversed` handling (a provider reversal SMS unlinking a verified
  payment) has a state slot but no UX yet — a later phase.
- Multi-currency reconciliation is out (RWF only).
