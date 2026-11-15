# S3 — Balance provenance (2026-11-15)

**Delivered (not yet wired into UI/API/flag):**
- `supabase/migrations/20261223000000_balance_observations.sql` — additive: `balance_observations`, `record_manual_balance_observation()`, `account_balance_baselines_v`.
- `web/lib/balance-status.ts` (+10 tests) — pure derivation of Confirmed / Estimated / Stale / Unavailable.
- Migration harness: new S3 block (15 assertions) and the three privilege/RLS tripwire counts updated (tables 131, authenticated table grants 168, authenticated function EXECUTE 121).

**Verified:** full `run_migration_tests.sh` on a disposable PostgreSQL 17 — 582 passed, 0 failed (on top of current main), including the two-fresh-application reproducibility check. `deno test web/lib` passes. Not run: Playwright, CI, any Supabase branch/prod apply.

## Rules (as implemented)
| Label | Condition |
|---|---|
| Confirmed | provider-reported baseline, nothing since, age ≤ threshold |
| Estimated | baseline + later settled, fully classified activity; or a user-stated baseline (a user statement is **never** "Confirmed") |
| Stale | baseline older than threshold (7 days, **owner to confirm**), or pending/unknown/unclassified activity since, or a reconciliation `mismatch` since; shows the last KNOWN balance with its as-of time, never a projection |
| Unavailable | no baseline; no number |
Manual observations: member+ only, append-only (corrections are new rows), audited, as_of can't be in the future, currency comes from the account, cross-tenant attempts get the same error as a missing account.

## Decisions / deviations from the S1 draft
- Provider balances are **not** duplicated into the new table (the S1 draft in PR #195 planned a backfill; `migration.md` there should be updated to match). Avoids a second source of truth and a sync job.
- `source` is constrained to `'manual'`; if provider observations are ever stored they need a deliberate migration.
- Gap detection reuses existing `balance_reconciliations` mismatches; S3 adds no new detector.

## Caveats
- Harness counts were re-based on `main` (which already has `20261222000000_create_manual_transaction`): tables 131, authenticated table grants 168, function EXECUTE 121.
- View uses the same "impossible received-balance" skip as `getCurrentBalance()`; same-instant ordering resolves by `created_at`.
- `balance_after_rwf` is RWF-only today, so provider baselines are currency-implicit; the view reports the account's currency.
- Non-balance-affecting but settled rows are ignored; rows with null effects count as "unresolved", which downgrades to Stale rather than guessing.
- Not built: API (`/api/mobile/accounts`, reconcile endpoint), wallet switcher UI, `BALANCE_PROVENANCE_ENABLED` flag, account-erasure/export coverage for `balance_observations` (**required before any rollout — see security.md**; it cascades with workspace/account deletion via FK, but the erasure path and data export must be confirmed).
