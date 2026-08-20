# Phase 4 planning notes

This file records architectural decisions and open questions for Phase 4
(wiring the already-built accounting engine into real transaction
processing) that were settled or investigated during **Phase 4.0** but are
explicitly out of scope to implement until a later, separately-authorized
sub-phase. See `PHASE_3_MIGRATION_REPORT.md` for what shipped in Phase 3
(the accounting engine and schema itself, not yet invoked by anything).

Phase 4.0 itself introduced no production financial behavior change - only
CI/quality-gate infrastructure (`.github/workflows/ci.yml`) and a fix to
the local/CI migration test harness (`tests/run_migration_tests.sh`
`external` mode). Nothing below has been implemented.

## A. Phase 4.1 must not assume a fixed historical transaction count

Earlier discovery-phase reasoning about backfilling accounting columns for
existing rows referenced "7 transactions" - that was a snapshot of
production at investigation time, not a durable assumption. Production is
live and ingesting continuously; by the time Phase 4.1 is authorized and
implemented, the eligible row count will almost certainly have changed and
will keep changing during the run itself.

Phase 4.1's design must instead:

- Determine the eligible row set **at execution time**, immediately before
  writing, via an explicit, bounded query (e.g. `WHERE
  principal_effect_rwf IS NULL` - the existing
  `transactions_new_accounting_fields_all_or_nothing` constraint already
  guarantees this is equivalent to "all five accounting columns unset").
- Log/report the exact eligible-row count and the explicit eligibility
  predicate used, before writing anything.
- Compute each row's accounting effect deterministically from
  `computeAccountingEffect()` only - never re-derive logic in SQL.
- Be idempotent: re-running against a partially-processed table must not
  double-apply or corrupt already-processed rows (rows with all five
  columns already set are simply outside the eligibility predicate).
- Bound each write (batch by id range or batch size, not a single
  unbounded `UPDATE ... WHERE ...` across an unknown and possibly large
  row count).
- Verify post-write: exact count of rows updated matches the pre-write
  eligible count (accounting for any that legitimately became ineligible
  concurrently, e.g. newly-inserted rows arriving mid-run), and that the
  accounting invariants (`transactions_new_accounting_fields_all_or_nothing`,
  `transactions_net_effect_matches_new_accounting_fields`) hold for every
  affected row - these are enforced by the constraints themselves, but the
  backfill must also independently assert this before declaring success.
- Have an explicit rollback/recovery procedure (e.g. re-null the five
  columns for a known id set) documented before the first production run,
  not improvised afterward.

**Not implemented in Phase 4.0.** This section records the design
constraint only.

## B. Phase 4.2 should not default to a second public Edge Function

Preference, to be confirmed before Phase 4.2 implementation: accounting
processing should run as an **internal, server-side step invoked directly
by `ingest-momo` after a successful insert** -
`ingest-momo → successful insertion → internal accounting processor →
computeAccountingEffect() → accounting UPDATE` - rather than as a second,
independently and publicly HTTP-reachable Edge Function (e.g. a
`process-accounting` function callable on its own).

Rationale: a second public HTTP endpoint is a second authentication/
authorization surface, a second thing that can be invoked out of order or
independently of ingestion, and a second thing to secure, monitor, and
reason about for no clear benefit given the current single-writer
ingestion flow. Nothing about the accounting engine's design
(`supabase/functions/_shared/`) requires a separate HTTP boundary - it is
already plain, dependency-free TypeScript importable from anywhere,
including directly from `ingest-momo/index.ts`.

This is a **default preference, not a final decision** - if a concrete
architectural reason for a separate HTTP boundary emerges during Phase
4.2's actual design (e.g. a genuine need to reprocess/backfill on demand
outside the ingestion path, decoupled retry/queueing semantics, etc.), it
should be weighed explicitly against this preference at that time, not
assumed away.

**Not implemented in Phase 4.0.**

## C. Phase 4.3 reconciliation opening balance remains deferred

`balance_reconciliations` (Phase 3) and `reconciliation.ts` (Phase 3) both
require an opening balance to reconcile the first checkpoint against.
Nothing in this codebase currently defines what that opening balance is or
where it comes from for the real MTN MoMo account - there is no
authoritative "balance as of a known point in time" input anywhere yet.

This must be **explicitly designed and approved** before Phase 4.3 wires
reconciliation into live operation. No opening balance is inferred or
manufactured by this document or by any code as of Phase 4.0. Candidate
sources (e.g. the earliest transaction's own `balance_after_rwf` treated
as authoritative, a manually-entered starting balance, a value sourced
from the MTN MoMo app/statement) are all still open and unevaluated.

**Not implemented in Phase 4.0.**

## Deferred: incoming-transfer + nonzero-fee ambiguity

Unchanged from Phase 3 - see "Known, documented, dormant semantic gap" in
`README.md`. Still non-blocking for Phase 4.0 (CI does not need this
resolved), and still not guessed at.

## processing_errors.stage: 'accounting' value - investigated, not added

Investigated as directed, read-only against production:

- **Current constraint** (`processing_errors_stage_check`, added in
  `20260818000000_baseline_existing_schema.sql`):
  `CHECK (stage = ANY (ARRAY['ingestion', 'validation', 'classification',
  'parsing', 'database', 'reporting', 'other']))`. No `'accounting'` value
  exists today.
- **Current stage values actually used**, confirmed via
  `grep -n "stage:" supabase/functions/ingest-momo/*.ts`: only `'parsing'`
  (index.ts, parse failure) and `'database'` (index.ts, insert failure).
  `'validation'`, `'classification'`, `'reporting'`, `'other'` are declared
  by the constraint but not currently emitted anywhere in this codebase.
- **Production data**: `processing_errors` is completely empty (`SELECT
  stage, count(*) ... GROUP BY stage` returns zero rows), confirmed via
  read-only introspection during Phase 4.0 preflight - there is no
  existing data of any stage to consider compatibility against.
- **Compatibility implications of adding `'accounting'`**: trivial and
  fully additive. `ALTER TABLE ... DROP CONSTRAINT ...; ALTER TABLE ...
  ADD CONSTRAINT ... CHECK (stage = ANY (ARRAY[..., 'accounting']))` (or
  an equivalent constraint replacement) would not touch any existing row,
  since the table is empty and every currently-used value remains valid
  either way.
- **Does Phase 4.2 genuinely need it?** Not yet clear, and not decided
  here. Whether an accounting-processing failure should be classified
  under the existing `'database'` stage (its failure mode - a rejected
  `UPDATE` - is mechanically a database error, same as today's insert
  failures) or deserves its own `'accounting'` stage depends on how Phase
  4.2 is actually designed (in particular, refinement B above: whether
  accounting runs inline within `ingest-momo`'s existing error-handling
  path, where `'database'` already fits naturally, or as a distinct
  internal step with its own failure semantics worth distinguishing in
  monitoring/reporting).

**Recommendation: do not add `'accounting'` yet.** Nothing currently
requires it, the table is empty so there is no urgency, and per the
standing instruction not to create a migration merely because it would be
convenient, this should be decided alongside Phase 4.2's actual design
(where the real failure-classification need, if any, will be concrete)
rather than spent now on a guess.
