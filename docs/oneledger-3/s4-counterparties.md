# S4 — Counterparty identity layer (2026-11-15)

**Delivered (not wired into UI/API/flag):**
- `supabase/migrations/20261225000000_counterparties.sql` — additive: `counterparties`, `counterparty_identifiers`, `counterparty_merge_events`, nullable `transactions.counterparty_id`; RPCs `backfill_counterparties`, `update_counterparty`, `merge_counterparties`, `undo_counterparty_merge`; internal `normalize_msisdn`; view `counterparty_summaries_v`.
- `web/lib/counterparties/normalize.ts` (+ shared `msisdn-vectors.json`, 4 tests) — TS mirror of the SQL key rules; SQL is asserted against the same vectors.
- Harness: 28 S4 assertions; counters re-based (tables 134, authenticated table grants 172, function EXECUTE 125).

**Verified:** full `run_migration_tests.sh` on disposable PostgreSQL 17 — 610 passed, 0 failed (stacked on S3/#196). `deno test web/lib` passes. Not run: Playwright, CI, any Supabase branch/prod apply, **a backfill against realistic/prod-shaped data volume**.

## Identity rules
| Evidence | Becomes | Confidence |
|---|---|---|
| Valid Rwandan mobile number in `counterparty_reference` (any format: 07…, +250…, 7…) | counterparty keyed by number, kind person | high |
| Numeric 4–8 digit reference on a `merchant_payment` | keyed by merchant code, kind merchant | high |
| Neither (incl. masked refs like `*********901`) | keyed by exact normalised label, kind unknown | **low** |
A transaction with a strong key never joins a name-only counterparty; same display name never merges strong identities; nothing crosses workspaces. Raw labels on transactions are never modified. Saved payees (`trusted_recipients`) supply name/kind, and `trusted_by_user` ones mark the counterparty `user_confirmed`; a counterparty the user has confirmed is never overwritten.

## Merge / undo
Merge is a **soft, reversible** pointer (`merged_into_id`, flattened to one hop); transactions and identifiers are never moved, so undo is exact. Undo is refused if later state depends on the merge (`merge_state_changed`) or if already undone. All of update/merge/undo are audited in `space_audit_events`; member+ only; cross-workspace ids are rejected.

## Summaries
`counterparty_summaries_v` (security_invoker) gives sent / received / count / first / last per effective counterparty and currency, using the Insights rules: settled only, merged duplicates and **confirmed self-transfers excluded**, refunds reduce "sent" and are not "received", inbound fees count as sent.

## Not done / decisions needed
- **Split by identifier** (move an identifier + its transactions to a new counterparty) is not built; undo-merge covers reversing merges only. A name-only counterparty that is really two people can currently only be renamed, not split.
- **No automatic resolution of new transactions.** Ingestion is untouched; `backfill_counterparties` must be called (on read, after import, or from a scheduled job — a decision for you). Until then `counterparty_id` is null for new rows.
- Identifiers are stored as normalised plaintext behind RLS (the "hash vs masked" owner decision in security.md is still open; hashing would block search-by-number). `maskMsisdn` exists for display.
- Cash Power token / kWh enrichment is **not** part of this slice (needs parser work + encryption decision).
- Account erasure/export coverage for the new tables is unconfirmed; the tables cascade from the workspace, but the erasure path and export (`account-data.ts`) must be checked before rollout.
- `counterparty_summaries_v` aggregates on read; no performance baseline yet (only the partial index on `transactions(workspace_id, counterparty_id)`).
- `balance_after`-style RWF-only: summaries read the legacy `*_rwf` effect columns and report the transaction's `currency`.
