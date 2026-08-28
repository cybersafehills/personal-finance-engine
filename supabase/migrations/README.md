# Migrations

Chronological migration history for the Personal Finance Engine schema.
All five migrations below are applied to the linked production project as
of 2026-08-19 - see `PHASE_3_MIGRATION_REPORT.md` for the full completion
report, including the two real incidents hit and fixed along the way (the
`net_effect_rwf` generated-column constraint bug, and the
`postgres`-owned function/sequence default-privilege gap - see
"supabase_admin default-privilege finding" below for the one item that
was deliberately left unfixed and why).

**Rule for all future migrations:** application-owned schema objects
(tables, functions, sequences) must remain `postgres`-owned unless an
explicit architectural decision changes that. Every migration in this
repository runs as `postgres` via `supabase db push` - anything created
under a different role's ownership falls outside what this project's own
migrations can safely alter later (see the `supabase_admin` finding
below for exactly what that costs).

## Production verification must be read-only

Discovered as an explicit rule during the Phase 3 closeout, after an
earlier verification step created and dropped a throwaway probe table
directly against the linked production project: **production
verification must be read-only by default.** Creating temporary/probe
tables, functions, triggers, rows, policies, or any other database object
solely to verify behavior against the linked production project is
prohibited unless explicitly authorized beforehand for that specific
check. Prove behavior in the disposable local PostgreSQL cluster
(`tests/run_migration_tests.sh`) instead - it exists precisely so
verification never needs to touch production. Read-only introspection
(`SELECT`, `information_schema`, `pg_catalog`) remains fine at any time.

## supabase_admin default-privilege finding

Read-only investigation of `pg_default_acl` on the linked production
project found **two** default-privilege entries for `public`-schema
tables/functions/sequences, not one:

- **`postgres`-owned** - the one `20260818130200_revoke_anon_authenticated_
  privileges.sql` hardens (tables) and
  `20260819000000_harden_function_and_sequence_default_privileges.sql`
  extends (functions, sequences, plus a PostgreSQL-specific quirk - see
  that file's comments for the empirically-verified detail that a
  schema-scoped `REVOKE ... FROM PUBLIC` does not suppress PostgreSQL's
  unconditional PUBLIC-EXECUTE-on-new-functions default; only a *global*
  (non-schema-scoped) revoke for the role does).
- **`supabase_admin`-owned** - still auto-grants `anon`/`authenticated`
  on anything that role might create in `public`. **Deliberately left
  untouched.**

Why left untouched, not merely deferred:

1. **Structurally outside this project's authority.** `supabase_admin` is
   the actual PostgreSQL superuser on this managed instance
   (`rolsuper = true`); the role every migration in this repository runs
   as (`postgres`) is not a superuser and is not a member of
   `supabase_admin` (confirmed via `pg_auth_members`). `ALTER DEFAULT
   PRIVILEGES FOR ROLE supabase_admin` requires being that role (or
   superuser) - attempting it from a `postgres`-run migration would fail
   outright with a permission error, not merely be inadvisable.
2. **Not currently exercised by any application object.** Every existing
   object in `public` (all 6 tables, both functions) is owned by
   `postgres`, confirmed via `pg_class.relowner`/`pg_proc.proowner` - zero
   objects are owned by `supabase_admin`, and this remained true after the
   2026-08-19 function/sequence hardening migration (re-verified: the
   `supabase_admin`-owned default-ACL entries are byte-identical before
   and after that migration - untouched, not just unused). It is
   Supabase's own internal control-plane role (extension installs,
   internal schema management, platform upgrades), not a role exposed for
   interactive project-owner use in the standard Supabase product; nothing
   in this codebase or workflow ever operates as it.
3. **Uncertain whether the platform's own RLS-auto-enable safety net
   would even cover a hypothetical `supabase_admin`-owned table.** The
   `ensure_rls` event trigger's function (`rls_auto_enable`) is
   `SECURITY DEFINER` but owned by `postgres`, not a superuser; its
   `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` could plausibly fail
   silently (the function swallows exceptions into a log line, not an
   error) against a table it doesn't own. This was **not verified** -
   doing so would require creating a `supabase_admin`-owned table, which
   is exactly the kind of production probe object this phase's read-only
   rule (above) now prohibits. Reported as an open, unresolved question
   rather than assumed either way.

**Recommended path if this is ever fully closed:** contact Supabase
support/the dashboard's project configuration options, since altering a
platform-managed role's defaults is outside what an application-level
migration can safely or even permissibly do from within the project.

## Pre-migration checklist

Before writing a migration that adds a constraint, index, or default over
an **existing** column, schema shape alone is not enough - verify all of
the following against the actual linked project, not just what a prior
migration file claims:

1. **Data type, nullability, default** - `information_schema.columns`.
2. **Generated-column status and expression** -
   `information_schema.columns.is_generated` /
   `.generation_expression` (or `pg_attribute.attgenerated` /
   `pg_get_expr(adbin, adrelid)` for the underlying default/generation
   expression). **This is the check that was missed before Phase 3's
   first production push attempt** - a column believed to be an ordinary
   nullable `bigint` (`transactions.net_effect_rwf`) was actually
   `GENERATED ALWAYS AS (...) STORED`, which can never be NULL. A
   constraint that assumed otherwise was unsatisfiable by any row, past
   or future, and only surfaced when `db push` failed against real data.
   See `20260818130000_accounting_foundation.sql`'s comments for the full
   story.
3. **Existing constraints and indexes** - `pg_constraint`,
   `pg_indexes`/`pg_get_indexdef`.
4. **Actual representative existing row values** for any column a new
   CHECK constraint will reference - not just its declared nullability/
   default. A column can be nullable-with-no-default and still have every
   existing row populated (as happened here). `SELECT COUNT(*) ... WHERE
   <column> IS NOT NULL` (or similar aggregate/count-only queries - never
   dump raw row content unnecessarily) is cheap insurance.
5. **Existing grants and RLS state** - `information_schema.role_table_grants`,
   `pg_class.relrowsecurity`/`relforcerowsecurity`, `pg_policies`.
6. **Any new function referenced by a CHECK constraint, trigger body, or
   RPC needs its own explicit `grant execute ... to authenticated` (or
   `service_role`) if it must be callable by that role - never assume it
   inherits one.** `20260819000000_harden_function_and_sequence_default_
   privileges.sql` globally revoked the default EXECUTE grant every new
   `public`-schema function would otherwise silently receive; every
   RPC-style function since has its own explicit grant for exactly this
   reason. **This is the check that was missed for Phase L's
   `is_valid_nav_order()`** - a non-`SECURITY DEFINER` function invoked
   from a CHECK constraint, so it runs with the *calling* role's own
   privileges. Without the grant, every authenticated insert/update
   hitting that constraint failed with "permission denied for function
   is_valid_nav_order", silently breaking every real save in production
   until `20260905000000_phase_l_grant_is_valid_nav_order_execute.sql`
   fixed it. `select grantee, privilege_type from information_schema.
   role_routine_grants where routine_name = '<name>';` is the cheap check
   before shipping any new function meant to be authenticated-callable.

## Testing the migration chain locally

`tests/run_migration_tests.sh` applies the full migration chain to a
disposable, version-matched (PostgreSQL 17) local cluster and asserts:

- the chain applies cleanly to a genuinely empty database (twice,
  byte-for-byte reproducibly),
- `transactions.net_effect_rwf` remains `GENERATED ALWAYS` throughout,
- a pre-existing production-like row survives the accounting-foundation
  migration completely unmodified,
- the new accounting-effect invariant accepts an all-NULL (unprocessed)
  state and a fully-consistent populated state, and rejects a partially
  populated state and a principal+fee sum that disagrees with the
  generated `net_effect_rwf`,
- `anon`/`authenticated` hold no table, function, or sequence privileges
  anywhere in the schema after the full chain, `service_role` keeps what
  it needs, and neither a future table, function, nor sequence
  auto-regains `anon`/`authenticated` access (including the PUBLIC-EXECUTE-
  on-functions quirk described below).

Per-phase functional blocks follow (Phase B ... Phase U, then **Bills &
Expenses Phase 1** - `20260922000000`: the document lifecycle CHECK, the
per-workspace `checksum_sha256` uniqueness guard, `transition_bill_
document`'s matrix + capability gating, the `record_bill_event` /
`enforce_bill_original_immutable` lockdowns, and cross-workspace RLS
isolation on `bill_documents`; then **Bills & Expenses Phase 2** -
`20260923000000`: `record_bill_extraction` / `system_transition_bill_
document` being `service_role`-only, a full worker round-trip
(`queued -> ... -> extracting -> record -> needs_review` with `doc_class`,
fields and line items), `is_current` supersession, `retry_bill_extraction`,
and cross-workspace RLS on the three extraction tables; then **Bills &
Expenses Phase 3** - `20260924000000`: `record_bill_validation` being
`service_role`-only, a validation run inserting findings + tallying
severities + advancing `validating -> needs_review`, `is_current`
supersession, and cross-workspace RLS on `bill_validations` /
`bill_validation_findings`; then **Bills & Expenses Phase 4** -
`20260925000000`: `get_bill_document_fingerprints` /
`record_bill_duplicate_candidates` being `service_role`-only, a
two-document content-duplicate round-trip,
`resolve_bill_duplicate_candidate` being member + `bill.review` gated,
and cross-workspace RLS on `bill_duplicate_candidates`; then **Bills &
Expenses Phase 5** - `20260926000000`: `create_supplier` being
`bill.manage`-gated with a per-workspace TIN guard (never merges),
`search_suppliers` ranking + member gate, `link_bill_supplier` being
`bill.review`-gated, `record_bill_supplier_candidates` being
`service_role`-only, and cross-workspace RLS on `suppliers` /
`bill_supplier_candidates`; then **Bills & Expenses Phase 6** -
`20260927000000`: `approve_bill`'s blocking-finding / unresolved-duplicate
/ no-self-approval-in-a-multi-member-workspace guards, idempotent
`post_bill` (a repeat with the same key is a no-op; a different key after
posting is rejected; link → matched, no link → posted),
`get_bill_transaction_search_set` /
`record_bill_transaction_match_candidates` being `service_role`-only, and
cross-workspace RLS on `bills`). The privilege-regression counts (public
table count, `authenticated` table-grant count, `authenticated`
function-EXECUTE count) are asserted exactly and must be updated in
lock-step with any migration that adds a table, an `authenticated` grant,
or an `authenticated`-callable function.

Run it with:

```sh
supabase/migrations/tests/run_migration_tests.sh
```

Requires PostgreSQL 17 `pg_ctl`/`initdb`/`psql`/`pg_dump` on `PATH`, or set
`PG_BIN_DIR` to their directory (defaults to Homebrew's
`/opt/homebrew/opt/postgresql@17/bin`). It never touches the linked
project - every database it creates is disposable and torn down when the
script exits, including on failure.

## Known, documented, dormant semantic gap

`transactions.net_effect_rwf`'s generated expression and
`computeAccountingEffect()` (`supabase/functions/_shared/accounting.ts`)
are proven equivalent for every currently-reachable transaction shape
(see `supabase/functions/_shared/tests/sql_generated_column_parity_test.ts`)
except one: an incoming transfer with a nonzero fee. No real MTN Rwanda SMS
sample showing that case exists, so neither implementation was changed to
guess an answer - see that test file and
`20260818130000_accounting_foundation.sql`'s comments for the full
reasoning. The `transactions_net_effect_matches_new_accounting_fields`
constraint independently prevents that ambiguity from being silently
resolved: it would reject any attempt to mark such a row "processed" with
a principal/fee split that disagrees with the generated value.
