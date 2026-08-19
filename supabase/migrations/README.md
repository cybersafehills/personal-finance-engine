# Migrations

Chronological migration history for the Personal Finance Engine schema.
All four migrations below are applied to the linked production project as
of 2026-08-19 - see `PHASE_3_MIGRATION_REPORT.md` for the full completion
report, including the one real incident hit and fixed along the way.

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
  generated `net_effect_rwf`.

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
