# E1 — Erasure and data-export coverage for the 3.0 tables (2026-11-15)

**Delivered:** migration `20261226000000_erasure_coverage_oneledger3.sql`, a failing-first erasure test in the migration harness (4 assertions), and the self-serve data export extended to schemaVersion 2 (`web/lib/account-data.ts`).

## A real defect, found by test
Before this change, **erasing a user whose Personal Space held a matched payment request aborted** (`payment_requests_matched_consistent` was violated when the FK nulled `matched_transaction_id` while deleting the transaction). Reproduced first (2 harness failures), then fixed (648 pass, 0 fail). Because the account-deletion cron is dark (`ACCOUNT_DELETION_EXECUTE_ENABLED`), nothing in production could have hit it, but it would have broken erasure as soon as the 3.0 stack shipped.

## What changed
| Table | On erasure | How |
|---|---|---|
| counterparties, counterparty_identifiers, counterparty_merge_events, balance_observations, payment_request_events | removed with the Personal Space (and any solo workspace) | existing workspace/request `ON DELETE CASCADE` — now proven by test |
| payment_requests (matched to a transaction) | removed with the transaction | matched-transaction FK changed to `ON DELETE CASCADE` |
| payment_requests the user created, **including in shared Spaces** | removed (public link then 404s) | `created_by` FK changed to `ON DELETE CASCADE` — the request holds the creator's own number and name, so SET NULL would have left it behind |
| counterparties / observations / merge events authored in a shared Space | stay, `created_by` set NULL | same as every other shared-ledger fact (attribution erased, record kept) |
`execute_account_deletion` itself is unchanged.

## Export (schemaVersion 2)
Adds `counterparties`, `counterpartyIdentifiers`, `balanceObservations`, `paymentRequests` (the user's own, explicit columns — the token digest is never selected) and `paymentRequestEvents`. Same RLS-scoped session client as before, so it can only return rows the caller may already read; the transaction cap/truncation behaviour is unchanged.

## Verified / not verified
**Verified:** full `run_migration_tests.sh` on disposable PostgreSQL 17 — 648 passed, 0 failed; `tsc` and `eslint` clean on the export change.
**Not verified:** the export was **not executed** (no Supabase here; only type-checked) — run it once against a branch with real rows; the deployed cron path; erasure of a user who is the *creator* of requests in a household where another member remains was tested, but not a user with hundreds of requests (cascade volume).
**Open policy question:** counterparty data in a shared household was entered by/for several people; export currently returns every counterparty of every workspace the user belongs to (consistent with `accounts`/`transactions`), not only ones the user created. Say if you want it narrowed.
