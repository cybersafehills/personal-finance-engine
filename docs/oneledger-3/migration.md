# OneLedger 3.0 — Migration plan (S1)

Rules: additive forward migrations in `supabase/migrations/` using the repo's timestamp naming (take next free stamp **after** `git fetch` — concurrent sessions share this repo); each must pass `supabase/migrations/tests/run_migration_tests.sh` (extend it per slice, incl. two-tenant RLS tests). Prod apply only via `deploy-supabase.yml` on green main, with owner approval. Rehearse on a Supabase branch / local DB with anonymised data, never prod.

| Slice | Migration | Contents | Backfill | Rollback / compensation |
|---|---|---|---|---|
| S3 | `balance_observations` | table (workspace_id, account_id, amount_minor, currency, as_of, source enum observed_provider/manual/derived, confidence, provenance jsonb, created_by), checks (currency upper, amount integer), index (account_id, as_of desc); RLS member-read, writes via RPC `record_balance_observation` | from `transactions.balance_after_rwf` latest per account → source=`observed_provider` (idempotent upsert keyed (account_id, source_txn_id)) | drop table (no dependents); legacy untouched |
| S3 | `account_balance_status_v` view | derives confirmed/estimated/stale/unavailable | none | drop view |
| S4 | `counterparties`, `counterparty_identifiers`, `counterparty_merge_events` | scoped unique (workspace_id, identifier_type, normalized_value); `transactions.counterparty_id` nullable FK added | idempotent job: group existing `counterparty_name/_reference` by normalised MSISDN/merchant code; names-only rows → separate `unknown`/low-confidence, never merged; seed explicit identities from `trusted_recipients` as `user_confirmed` | null out `counterparty_id`, drop tables; merge events allow logical undo |
| S5 | `payment_requests`, `payment_request_events` | token_hash unique, status check, expiry, amount>0, currency, audit events; RLS owner/workspace; public resolve through a narrow `security definer` function returning only safe columns | none | drop tables |
| all | `audit_events` extension | reuse `space_audit_events`/`payment_audit_events` pattern; add actions for merge/undo/reconcile/request lifecycle | none | n/a |

Pre/post checks per backfill: row counts and Σ amounts by account unchanged (transactions untouched), unique-key violation count = 0, rerun diff = 0. Interrupted backfill is safe because it is keyed/idempotent and resumable.
No change to `transactions` amount semantics. Optional later (not in 3.0): currency-neutral columns on `transactions` via expand-and-contract.
