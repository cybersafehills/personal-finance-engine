# Phase 3 — Financial Ledger, Accounting Semantics & Reconciliation

**Status: COMPLETE.** All four migrations are applied to the linked
production project (`zttxsaiywkfrbdxgzbjd`, "Personal Finance Engine").

## Migration history (final)

| Version | File | Status |
|---|---|---|
| `20260818000000` | `baseline_existing_schema.sql` | Applied (metadata-only repair — objects pre-existed out-of-band) |
| `20260818130000` | `accounting_foundation.sql` | Applied 2026-08-19 |
| `20260818130100` | `balance_reconciliations.sql` | Applied 2026-08-19 |
| `20260818130200` | `revoke_anon_authenticated_privileges.sql` | Applied 2026-08-19 |

Confirmed via `supabase migration list`: all four show matching `local`/`remote` versions.

## What shipped

- **`accounts` table** — multi-account readiness, seeded with exactly one
  row (`MTN MoMo (Primary)`), not yet wired into ingestion.
- **Accounting-effect columns on `transactions`** —
  `account_id`, `principal_effect_rwf`, `fee_effect_rwf`, `settlement_state`,
  `affects_balance`, `effect_reason`. All nullable, unpopulated for every
  existing row (7 at time of migration) — no backfill, no data touched.
- **`balance_reconciliations` table** — reconciliation storage, currently empty.
- **Privilege hardening** — `anon`/`authenticated` revoked from every table
  in the schema; `service_role` unaffected; `ALTER DEFAULT PRIVILEGES`
  fixed for the `postgres`-owned entry so future tables don't
  auto-regrant them.
- **Canonical accounting engine** (`supabase/functions/_shared/`) — pure,
  independently-tested TypeScript modules (`accounting.ts`,
  `reconciliation.ts`, `kigali-time.ts`, `money.ts`). Not yet invoked by
  any Edge Function or scheduled process.

## The one real incident, and how it was resolved

The first `db push` attempt failed: `transactions.net_effect_rwf` turned
out to be a pre-existing `GENERATED ALWAYS AS (...) STORED` column, not an
ordinary nullable `bigint` as the reconstructed baseline had assumed. The
original all-or-nothing constraint incorrectly required it to be `NULL`
for "unprocessed" rows — impossible for a generated column, so the
constraint could never have been satisfied by any row, past or future.

Root-caused via read-only production introspection (no data exposed
beyond aggregate counts), then fixed:

- Split the invariant into two constraints — one governing only the five
  genuinely-new nullable columns, one cross-checking the generated
  `net_effect_rwf` against them once populated.
- Corrected the baseline migration to declare `net_effect_rwf` accurately.
- Added defense-in-depth sign checks (fee always ≤ 0; principal sign
  matches direction when settled) caught during adversarial self-review.
- Documented, rather than guessed at, one remaining dormant semantic gap:
  incoming money with a nonzero fee has no real MTN sample to confirm the
  correct rule, so PostgreSQL's and TypeScript's formulas are allowed to
  diverge only there, with tests pinning that divergence as intentional.
- Added a disposable-PostgreSQL migration test suite
  (`supabase/migrations/tests/run_migration_tests.sh`, PG17-matched, 16
  assertions) and an expanded pre-migration checklist
  (`supabase/migrations/README.md`) so a generated-column oversight like
  this is caught locally next time, not in production.

See `20260818130000_accounting_foundation.sql`'s inline comments for the
full technical account, and git history on this branch for the complete
investigation-and-remediation trail.

## Post-migration verification (all confirmed via read-only introspection)

- All 6 tables present with correct columns/constraints/indexes.
- `net_effect_rwf` still `GENERATED ALWAYS` — untouched.
- Existing 7 `transactions` rows unchanged; all 5 new columns `NULL`.
- `accounts` seed: exactly one row, as designed.
- `balance_reconciliations`: empty, as designed.
- RLS enabled on all 6 tables, zero permissive policies.
- Zero `anon`/`authenticated`/`PUBLIC` grants anywhere; `service_role` full
  access preserved.
- `ingest-momo` Edge Function unmodified, still `ACTIVE`, zero new
  `processing_errors`.
- Local quality gates: `deno fmt --check`, `deno lint`, `deno check`,
  `deno test` — 92/92 passing.

## Known residual item (pre-existing, not introduced by Phase 3)

`pg_default_acl` carries two default-privilege entries for `public`-schema
tables: one owned by `postgres` (fixed by `20260818130200`) and one owned
by `supabase_admin` (still auto-grants `anon`/`authenticated`). Migrations
applied via `db push` run as `postgres`, so this doesn't affect anything
Phase 3 created — but a table created out-of-band by a different path
(e.g., the dashboard SQL editor) could still auto-inherit those grants.
Not fixed here; flagged for a future decision.

## Explicitly not done in Phase 3

No Edge Function deployment or code change, no application code invoking
the new accounting engine yet, no backfill of existing rows' accounting
columns, no daily close / briefing / budgets / dashboards / AI-generated
explanations, no merge to `main`.
