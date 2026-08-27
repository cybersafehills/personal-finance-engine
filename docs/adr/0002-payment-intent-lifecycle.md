# ADR 0002: Payment intents are governed by a server-enforced state machine

- **Status:** Accepted
- **Date:** 2026-08-27
- **Context:** Introduced with Pay & Services Phase 2a (Assisted Quick Pay).
  Builds on ADR 0001 (non-custodial boundary).

## Decision

Every Assisted Quick Pay payment is a `payment_intents` row whose `state`
is changed **only** by the Phase N `SECURITY DEFINER` RPCs
(`create_payment_intent`, `transition_payment_intent`,
`manually_confirm_payment`, `expire_stale_payment_intents`). Clients never
`UPDATE` `payment_intents.state` directly — there is no RLS write policy
for `authenticated` on that table at all.

### Lifecycle

```
draft ─▶ initiated ─▶ awaiting_verification ─▶ successful | failed | expired | requires_reconciliation
draft ─▶ cancelled
initiated | awaiting_verification ─▶ cancelled
```

`payment_intent_transition_allowed(from, to, actor)` is the single source
of truth. For an authenticated (`user`) caller only the transitions above
are permitted. `successful` via a plain transition is **impossible** for a
user — it is reached only by:

- **`manually_confirm_payment`** (Phase 2a): stamps `manually_confirmed_at`
  / `manually_confirmed_by`, leaves `verified_at` **NULL**. The UI renders
  **"Manually confirmed"** with a neutral tone — never a success colour or
  a check. `web/lib/pay/state.ts#statusTone` returns `"positive"` only when
  `verified_at` is set.
- **system / ingestion reconciliation** (Phase 2b): sets `verified_at`
  alongside `linked_transaction_id` (a DB CHECK enforces they co-exist),
  or routes to `requires_reconciliation` when evidence conflicts. These
  transitions are gated to `service_role` and not exposed to any
  authenticated caller.

### Idempotency

`create_payment_intent` generates the `idempotency_key` server-side (or
reuses one the client already holds for a resume). The insert is
`ON CONFLICT (workspace_id, idempotency_key) DO NOTHING` followed by a
`SELECT`, so a rapid double-submit or a retried request yields **one**
intent and the response carries `existed: true`. The draft form holds one
key per mount and passes it on every submit.

### Why

- A handoff (dialer opened, code copied, QR shown) is a **navigation
  event**, not a payment. The state machine makes it impossible for the
  UI or a client bug to promote a handoff to "paid".
- `manually_confirmed` and `verified` are different facts. Collapsing them
  would let the app imply provider confirmation it does not have.
- Server-generated idempotency keys + a unique constraint are the same
  duplicate-prevention pattern already used for `momo_messages` and
  `report_runs`.

## Consequences

- Phase 2b adds `system_transition_payment_intent` (service_role only) and
  populates `payment_reconciliations` — purely additive; the table already
  ships in Phase N.
- `processing` is reserved in the CHECK set for Phase 3 (real provider
  API) and is unreachable in 2a/2b.
- The lazy-expiry view in `web/lib/pay/intents.ts` and the
  `expire_stale_payment_intents` cron tick must agree; the RPC is the
  authoritative writer, the view is display-only.
