# Ingestion pipeline & the raw-events processor

The shared parse→`transactions` pipeline and the worker that runs it for the
capture channel. ADR 0009 has the rationale.

## `supabase/functions/_shared/ingestion-pipeline.ts`

`normalizeInboundMessage(input, route, refs, deps)` — the parse → normalized
ledger row logic, factored as **pure dependency-injected** code (like
`ingest-momo/connection-resolver.ts`) so every branch is fake-testable
(`_shared/tests/ingestion_pipeline_test.ts`).

It mirrors `ingest-momo/index.ts`'s post-evidence steps exactly:

```
parse (parseMomoMessage)                → null ⇒ needs_review
exact MTN transaction-id dedupe         → hit  ⇒ duplicate_transaction (evidence superseded)
computeAccountingEffect                 → throw ⇒ accounting_failed
live account re-check (findActiveAccount)→ gone ⇒ account_unavailable
categorization (evaluatePolicies)
transaction-level fingerprint dedupe    → advisory dedupe_state only, never blocks
transactions insert                     → error ⇒ db_error
finalize raw_financial_events           ┐
category history                        │ best-effort — a failure here
mark momo_messages processed            │ never changes the result
opt-in payment reconciliation           │
budget threshold sweep                  │
touch ingestion_connections.last_used_at┘
                                        → processed
```

- **Never routes or authorizes.** `route` is resolved and re-verified by the
  caller from trusted server state.
- **Never creates a second transaction row; never auto-merges a duplicate.**
- Result: `processed | needs_review | duplicate_transaction | account_unavailable
  | accounting_failed | db_error`.

### `ingest-momo` still runs its own copy

`ingest-momo/index.ts` keeps its inline implementation of this logic for now —
migrating it onto this module is a **separate PR** once the module is proven on
the (dark, low-volume) capture channel. Until then the two implementations must
be kept in step by hand; this file and `_shared/tests/ingestion_pipeline_test.ts`
are the reference.

## `supabase/functions/process-raw-events` (the worker)

Claims `pending` capture `raw_financial_events` rows and normalizes them.

**Gates (both required):** `DEVICE_PAIRING_V2=enabled` and a constant-time
`X-Processor-Secret` == `RAW_EVENTS_PROCESSOR_SECRET` (≥ 32 chars). Missing
either → `404` / `401` no-op. `POST` only.

**Per tick:**

1. `release_stale_processing_capture_events()` — returns rows stuck in
   `processing` (crashed worker) to `pending`.
2. `claim_pending_capture_events(20)` — `UPDATE … SET parse_status='processing'
   … FOR UPDATE SKIP LOCKED RETURNING …` — concurrent-safe lease.
3. For each claimed row:
   - route from the row's `ingestion_connection_id` (`account_id` / `workspace_id`
     from `ingestion_connections`, same routing `ingest-momo` uses).
   - synthesize a `momo_messages` row (`source='iphone_capture_v2'`,
     `message_fingerprint` = the row's `payload_hash`). On `23505` (the legacy
     Shortcut already ingested this exact message for this connection) → point
     the evidence at that transaction, `superseded`, done.
   - `normalizeInboundMessage(...)` with real `deps`.
   - map result → `raw_financial_events.parse_status`: `processed`→`normalized`,
     `duplicate_transaction`→`superseded`,
     `needs_review`/`account_unavailable`/`accounting_failed`→`failed`,
     `db_error`→`pending` (retried; `raw_payload.processor_attempts` caps at 5,
     then `failed`).
4. Returns `{ ok, claimed, processed, superseded, failed, retried }`.

### `raw_financial_events.parse_status` lifecycle

```
pending ──claim──▶ processing ──▶ normalized   (a transaction exists, canonical_transaction_id set)
                              ├──▶ superseded   (an earlier transaction already covers it)
                              ├──▶ rejected     (unparseable — kept as evidence)
                              ├──▶ failed       (deterministic failure — kept for inspection)
                              └──▶ pending      (transient failure — retried, capped)
stuck `processing` ──release_stale──▶ pending
```

## Config

| Name | Where | Effect |
|---|---|---|
| `DEVICE_PAIRING_V2` | Edge secret | must be `enabled` for the worker to run |
| `RAW_EVENTS_PROCESSOR_SECRET` | Edge secret | ≥ 32 chars, presented in `X-Processor-Secret` |
| `SMS_RECONCILIATION_ENABLED` / `SMS_RECONCILIATION_MODE` | Edge secret | opt-in; same semantics as `ingest-momo` |

## Schedule

`supabase/scheduling/activate_raw_events_processor.sql` (pg_cron, every 1–2 min),
or the Dashboard. Manual: `curl -X POST …/functions/v1/process-raw-events -H
"x-processor-secret: <secret>"`. Idempotent — safe to call at any frequency.
