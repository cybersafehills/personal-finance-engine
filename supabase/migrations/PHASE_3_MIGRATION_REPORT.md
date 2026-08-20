# Phase 3 — Financial Ledger, Accounting Semantics & Reconciliation

**Status: COMPLETE, including security closeout.** All five migrations
are applied to the linked production project (`zttxsaiywkfrbdxgzbjd`,
"Personal Finance Engine").

## Migration history (final)

| Version | File | Status |
|---|---|---|
| `20260818000000` | `baseline_existing_schema.sql` | Applied (metadata-only repair — objects pre-existed out-of-band) |
| `20260818130000` | `accounting_foundation.sql` | Applied 2026-08-19 |
| `20260818130100` | `balance_reconciliations.sql` | Applied 2026-08-19 |
| `20260818130200` | `revoke_anon_authenticated_privileges.sql` | Applied 2026-08-19 |
| `20260819000000` | `harden_function_and_sequence_default_privileges.sql` | Applied 2026-08-19 (security closeout) |

Confirmed via `supabase migration list`: all five show matching `local`/`remote` versions.

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

## Security closeout (2026-08-19)

Following the initial four-migration application, `pg_default_acl` was
found to carry default-privilege entries beyond just the `postgres`-owned
**table** entry `20260818130200` fixed: the same `postgres`-owned role
also still auto-granted `anon`/`authenticated` on **functions** (EXECUTE)
and **sequences** (USAGE), confirmed live on the two existing functions
(`set_updated_at`, `rls_auto_enable`). Investigating this also surfaced an
empirically-verified PostgreSQL quirk: EXECUTE on new functions is granted
to the `PUBLIC` pseudo-role unconditionally, and a schema-scoped
`ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM PUBLIC` does not suppress
it — only a *global* (non-schema-scoped) revoke for the role does. Local
testing caught this directly (a schema-scoped-only fix left `PUBLIC` in
place, silently defeating the anon/authenticated-specific revoke through
inheritance).

`20260819000000_harden_function_and_sequence_default_privileges.sql`
closes this for everything within this project's authority: the
`postgres`-owned function/sequence defaults, and the two existing
functions directly. Post-migration, all three `postgres`-owned default-ACL
entries (tables, functions, sequences) are clean, and both existing
functions show `{postgres=X/postgres, service_role=X/postgres}` with no
`anon`, `authenticated`, or bare `PUBLIC` entry.

**Deliberately not touched:** a separate `supabase_admin`-owned
default-ACL entry (tables, functions, sequences) still auto-grants
`anon`/`authenticated`. This is a **known, Supabase-managed residual
item**, not a Phase 3 oversight left unfixed by choice — `postgres` (the
role every migration in this repository runs as) is not a superuser and
is not a member of `supabase_admin`, so altering that role's defaults is
structurally outside this project's own migration authority (confirmed:
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` would fail outright
with a permission error if attempted). It is **not currently exercised by
any application object** — every table and function in `public` is
`postgres`-owned, re-confirmed unchanged after this closeout migration.
Full investigation, reasoning, and the recommended path if it's ever
fully closed (Supabase support, not an application migration) are in
`supabase/migrations/README.md` ("supabase\_admin default-privilege
finding").

**Standing rule adopted going forward:** application-owned schema objects
must remain `postgres`-owned unless an explicit architectural decision
changes that (see `supabase/migrations/README.md`).

**Standing rule adopted for production verification:** read-only by
default. Creating temporary/probe tables, functions, triggers, rows,
policies, or any other database object solely to verify behavior against
the linked production project is prohibited unless explicitly authorized
beforehand — prove behavior in the disposable local PostgreSQL cluster
instead. Adopted after an earlier verification step created and dropped a
throwaway probe table directly against production; documented in
`supabase/migrations/README.md`.

### Security closeout post-migration verification

- Migration recorded as applied (`supabase migration list`).
- All 6 tables present, `postgres`-owned, RLS enabled.
- Existing data (7/7/1/0/1/0 rows) byte-identical before and after.
- Table grants for `anon`/`authenticated` unaffected (still zero — this
  migration doesn't touch tables at the object level, only functions/
  sequences).
- Both existing functions: clean ACLs, no `anon`/`authenticated`/`PUBLIC`.
- All three `postgres`-owned default-ACL entries clean (tables, functions,
  sequences) — verified via catalog inspection only, no probe objects.
- `supabase_admin`-owned entries byte-identical pre/post-migration —
  confirmed untouched.
- `ingest-momo` unmodified, still `ACTIVE`, zero new `processing_errors`.
- Local quality gates: 92/92 Deno tests, 21/21 local migration-chain
  assertions, all passing.
- Recovery checkpoint established beforehand (`pg_dump`, version-matched
  PG 17.11, verified non-zero/complete/checksummed) — see the backup
  procedure notes from the earlier Phase 3 application for the mechanism;
  no credentials were exposed in any command output during this closeout.

## Explicitly not done in Phase 3

No Edge Function deployment or code change, no application code invoking
the new accounting engine yet, no backfill of existing rows' accounting
columns, no daily close / briefing / budgets / dashboards / AI-generated
explanations, no merge to `main`, and no attempt to alter the
`supabase_admin`-owned default-privilege configuration.
