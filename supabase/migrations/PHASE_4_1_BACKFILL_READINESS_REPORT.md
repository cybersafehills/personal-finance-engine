# Phase 4.1 — Accounting Backfill Readiness Report

**Status: discovery, design, and local/isolated testing complete. NOT
executed against production. No production write has occurred.** This
report is the checkpoint required before requesting authorization to run
anything against the linked production project (`zttxsaiywkfrbdxgzbjd`).

Per the standing Phase 4 safety rule, repository implementation of this
tooling does not authorize production dry-run or production write - both
remain separately gated.

## 1. Current production transaction count

**7**, confirmed via read-only introspection immediately before writing
this report (`select count(*) from transactions`).

## 2. Current eligible backfill count

**7 of 7** - every existing transaction is unprocessed
(`principal_effect_rwf IS NULL` for all 7) and every one satisfies the full
eligibility predicate (see §3). Confirmed two ways: once via the
TypeScript tool's own `classifyRow()` logic exercised against synthetic and
seeded-database rows (§14), and independently via an equivalent read-only
SQL query run directly against production (§15) - both agree.

## 3. Exact eligibility predicate

A row is **eligible** if and only if:

1. All five accounting columns (`principal_effect_rwf`, `fee_effect_rwf`,
   `settlement_state`, `affects_balance`, `effect_reason`) are currently
   `NULL` (not already processed, and not a partially-populated
   contradiction - see §4).
2. `amount_rwf >= 0` and `fee_rwf >= 0` (structurally guaranteed by
   existing `CHECK` constraints, re-verified defensively by the tool
   itself rather than trusted blindly).
3. `direction` is one of `in`, `out`, `neutral` and `status` is one of
   `success`, `failed`, `reversed`, `pending`, `unknown` (structurally
   guaranteed by existing `CHECK` constraints, re-verified defensively).
4. **Not** (`direction = 'in' AND fee_rwf > 0`) - the one documented,
   dormant TS/SQL divergence (incoming transfer with a nonzero fee) is
   explicitly excluded here, before `computeAccountingEffect()` is ever
   called for it, not left to the database's
   `transactions_net_effect_matches_new_accounting_fields` constraint to
   reject as the only backstop.
5. `computeAccountingEffect()`'s resulting `net_effect_rwf` agrees with the
   row's existing generated `net_effect_rwf` column - an independent local
   re-verification of the same cross-check the database constraint
   performs. Any disagreement is treated as contradictory, not silently
   accepted or overwritten.

This predicate respects the Phase 3 all-or-nothing accounting invariant by
construction: the tool only ever writes all five columns together, in a
single statement, computed by `computeAccountingEffect()`.

## 4. Excluded rows and reasons

None, for the current production population (0 rows fall into any excluded
category). The tool defines and correctly classifies six exhaustive
categories, exercised in local testing (§14):

| Category | Meaning | Currently reachable in production? |
|---|---|---|
| `already_processed` | all five accounting columns already set | no (0 rows) |
| `contradictory_partial_state` | some but not all five columns set, or `computeAccountingEffect()` disagrees with the generated `net_effect_rwf` | structurally prevented by existing `CHECK` constraints |
| `malformed_negative_amount` | `amount_rwf` or `fee_rwf` negative | structurally prevented by existing `CHECK` constraints |
| `unsupported_incoming_with_fee` | incoming transfer with nonzero fee | no (0 rows; see §12) |
| `unrecognized_status_or_direction` | value outside the known enums | structurally prevented by existing `CHECK` constraints |
| `eligible` | passes all checks | yes - all 7 current rows |

## 5. Transaction-shape distribution (production, read-only, aggregated only)

- Total: 7. Status: all 7 `success` (no `failed`/`pending`/`reversed`/
  `unknown` rows exist yet). Direction: 5 `out`, 2 `in`, 0 `neutral`.
  Transaction type: 2 `merchant_payment`, 2 `money_received`, 2
  `send_money`, 1 `airtime`.
- Fees: `out` rows - 2 with a nonzero fee, 3 with none. `in` rows - 0 with
  a nonzero fee (confirms the incoming+fee case has never occurred).
- No duplicate `momo_message_id` or `external_transaction_id`.
- No row with a partially-populated accounting state.
- No `NULL` in any required source field (`amount_rwf`, `fee_rwf`,
  `status`, `direction`).
- `account_id` is `NULL` on all 7 rows - reserved for future multi-account
  support per the Phase 3 migration comment, not part of the accounting-
  effect invariant, and intentionally **not** written by this tool (see
  §9 - out of scope for Phase 4.1).

## 6. Newly discovered edge cases

One, found and fixed during implementation (not a production data issue -
a bug in the tool itself, caught entirely in isolated testing): the
idempotent-rerun / "already applied" detection compared a freshly-read
`principal_effect_rwf`/`fee_effect_rwf` (which the `postgres.js` driver
returns as strings, to preserve `bigint` precision) against
`computeAccountingEffect()`'s plain-number output using strict `===`,
which is always false across the string/number type boundary - every
already-applied row was being misclassified as a genuine conflict
(`cas_failed_unexpected_state`) on rerun instead of a benign no-op. Fixed
by normalizing the freshly-read values to numbers immediately after
fetching, before any comparison. Caught by the integration test's explicit
idempotent-rerun assertions (§14), not discovered against production - this
is exactly the class of bug the "test before production" checkpoint exists
to catch.

No production data anomaly was found: the eligibility investigation (§5)
surfaced no duplicates, no contradictions, no already-partially-processed
rows, and no incoming-with-fee rows.

## 7. Backfill implementation architecture

A one-time, manually-invoked, repository-controlled Deno script -
**not** a deployed Edge Function, per Phase 4 refinement B recorded in
`PHASE_4_PLANNING.md`. Connects directly to Postgres (not via PostgREST/
service-role key), because every write must be a genuine single-statement
compare-and-set, and a maintenance script has no reason to go through the
REST layer.

Three explicit modes, each requiring a flag - there is no default mode
that writes anything:

- **`plan`** (read-only): classifies every transaction, computes the
  intended effect for every eligible row via the canonical
  `computeAccountingEffect()`, and writes a timestamped plan file. Never
  issues a write.
- **`execute --plan <path> --confirm`**: the only mode that writes.
  `--confirm` is mandatory. For each eligible row in the given plan,
  issues one parameterized compare-and-set `UPDATE`. Writes a result-log
  file recording, per row, the before-state and the outcome.
- **`rollback --result-log <path> --confirm`**: reverts only the rows a
  specific execute run actually updated, each via its own compare-and-set
  that only reverts if the row still holds exactly what that run wrote.

## 8. Files created/modified

- `scripts/phase-4-1-accounting-backfill.ts` (new) - the tool itself
  (`classifyRow`, `buildPlan`, `executePlan`, `rollbackResultLog`, plus a
  CLI entry point).
- `scripts/tests/run_backfill_tests.sh` (new) - spawns a disposable,
  version-matched PostgreSQL 17 cluster, applies the full migration chain,
  seeds representative transaction shapes, and runs the Deno test suite
  against it. Mirrors `supabase/migrations/tests/run_migration_tests.sh`'s
  spawn-mode pattern; deliberately a focused sibling, not a shared
  generalization.
- `scripts/tests/phase_4_1_backfill_test.ts` (new) - 9 pure-function unit
  tests (`classifyRow` edge cases unreachable via the seeded database,
  because the database's own `CHECK` constraints already prevent them) and
  2 integration tests against the real disposable database.
- `.gitignore` (modified) - added `scripts/backfill-runs/`: plan/execute/
  rollback output files contain real financial data snapshots and must
  never be committed.
- `supabase/migrations/PHASE_4_1_BACKFILL_READINESS_REPORT.md` (this
  file).

No production migration, no `ingest-momo` change, no Edge Function
deployment.

## 9. Exact fields that would be updated

Only the five Phase 3 accounting-effect columns on `transactions`:
`principal_effect_rwf`, `fee_effect_rwf`, `settlement_state`,
`affects_balance`, `effect_reason`. Nothing else - not `amount_rwf`,
`fee_rwf`, `status`, `direction`, `account_id`, or any other column. The
compare-and-set `WHERE` clause additionally requires the five source
fields used in the computation (`amount_rwf`, `fee_rwf`, `status`,
`direction`) to still match what the plan read, so a row can never be
updated based on stale source data either.

## 10. Concurrency / high-water-mark strategy

Production is live; the tool does not assume it stays static. The
eligible-row set is captured once, explicitly, as a fixed list of
transaction IDs in the plan file at `plan` time - not re-derived at
`execute` time. Any transaction inserted after the plan was generated is
simply absent from that list and cannot be touched by that plan's
`execute` run, by construction (there is no "or later-arriving rows"
clause anywhere in the tool). A transaction created by `ingest-momo` while
`execute` is running is therefore never at risk of double-processing by
this run; it would only ever be picked up by a subsequent, separately
generated plan (Phase 4.1, run again) or by Phase 4.2's own logic once
that exists - the two are not designed to race, because Phase 4.2 is not
implemented yet and this tool touches only a fixed, pre-captured ID list.

## 11. Compare-and-set strategy

Every write is a single SQL statement of the form:

```sql
update transactions
set principal_effect_rwf = ..., fee_effect_rwf = ..., settlement_state = ...,
    affects_balance = ..., effect_reason = ...
where id = <id>
  and principal_effect_rwf is null and fee_effect_rwf is null
  and settlement_state is null and affects_balance is null and effect_reason is null
  and amount_rwf = <plan-time value> and fee_rwf = <plan-time value>
  and status = <plan-time value> and direction = <plan-time value>
returning id
```

If a row changed between `plan` and `execute` - its accounting columns got
populated by something else, or its source fields changed - zero rows
match and nothing is written. The tool then distinguishes a **benign**
zero-match (the row already holds exactly the intended result - an
idempotent rerun) from a **genuine conflict** (the row holds something
else) by re-reading the row and comparing; only the genuine-conflict case
is flagged for manual review. Never retried, never forced.

## 12. Idempotency proof

Proven in the integration test (§14, second test): running `executePlan`
twice against the same plan updates each eligible row exactly once on the
first pass and, on the second (rerun) pass, reports
`already_applied_matches_plan` for every row that was actually written the
first time - no error, no double-write, no change to the database state.
A row that never got written the first time (because it changed
concurrently) continues to correctly report a conflict on rerun rather
than being silently forced through.

## 13. Dry-run results

`plan` mode was exercised against a disposable database (§14 and the CLI
smoke test below) and produces exactly the read/eligibility/compute/
validate pipeline required, with **no `UPDATE`, `INSERT`, `DELETE`, or DDL
issued** - confirmed by inspecting the tool's own code path (the `plan`
command only ever runs a single `SELECT`) and by observing the database
was unchanged after each `plan` invocation in testing.

A live CLI smoke test (`deno run ... execute` **without** `--confirm`) was
also run to confirm the mandatory-confirmation gate actually refuses to
proceed:

```
FAIL: execute requires --confirm - this is the only mode that writes to
the database. Refusing to proceed without it.
```

## 14. Local/isolated test results

All against a disposable, version-matched PostgreSQL 17 cluster (never the
linked production project), via `scripts/tests/run_backfill_tests.sh`:

- **9 pure-function tests** (`classifyRow`), covering every category in
  §4 including the three structurally-unreachable-in-production ones
  (malformed negative amount, unrecognized direction, unrecognized
  status, contradictory partial state, and a synthetic `net_effect_rwf`
  disagreement) via synthetic in-memory rows, plus the reachable
  incoming-with-fee exclusion and a valid eligible computation - **9/9
  pass**.
- **2 integration tests** against a real seeded database covering: every
  currently-supported transaction shape (settled outgoing with fee,
  settled incoming no fee, failed/zero-effect, neutral/unknown/zero-
  effect), an already-processed row (must be skipped, never re-touched),
  the unsupported incoming-with-fee row (must be excluded, never written -
  verified directly against the database afterward), a simulated
  concurrent state change (row mutated between plan and execute -
  correctly detected as a conflict, never overwritten), idempotent rerun
  of a partially-completed execution (already-written rows report a
  benign no-op; the still-conflicting row keeps correctly conflicting),
  and full rollback + re-plan (rolled-back rows become eligible again,
  proving reversibility is real, not just claimed) - **2/2 pass**.
- **CLI smoke test** (not part of the automated suite, run manually
  against a separate disposable instance): `plan` → `execute` (confirmed
  the `--confirm` gate blocks an unconfirmed call, then ran confirmed) →
  `rollback`, with the database state inspected via direct `psql` queries
  at each step - the row was written correctly, then reverted to exactly
  its original `NULL` state.

Total: **11/11** automated tests pass, plus the manual CLI smoke test.
Command: `bash scripts/tests/run_backfill_tests.sh`.

## 15. Production read-only preflight results

Performed immediately before writing this report, read-only only (no
`UPDATE`/`INSERT`/`DELETE`/DDL):

- `supabase migration list`: all 5 migrations still matched
  local/remote - unchanged since Phase 4.0.
- `supabase functions list`: `ingest-momo` still `ACTIVE`, version 4 -
  unchanged.
- `processing_errors`: still empty (0 rows) - unchanged.
- `transactions`: 7 total, 0 already processed, 7 unprocessed - matches
  the Phase 3/4.0 baseline exactly; production has not changed in the
  interim.
- An equivalent eligibility predicate expressed directly as a read-only
  SQL aggregate query (independent of the TypeScript tool, as a
  cross-check) was run directly against production: 0 already-processed,
  0 unsupported-incoming-with-fee, 0 malformed, 0 bad-direction, 0
  bad-status, **7 eligible** - agrees exactly with §2 and with what
  `classifyRow()` would compute.

No discrepancy between development-time assumptions and current production
state was found. Had one existed, this report would describe the
resulting updated plan rather than proceeding as if the earlier count
still held.

## 16. Backup procedure

Not yet executed (no production write is authorized yet). When execution
is authorized, the procedure is:

1. Take a fresh `pg_dump` backup checkpoint of the linked production
   project (same version-matched, verified-non-zero/checksummed procedure
   used for every Phase 3 production migration), piped directly to a file,
   never printed to a terminal or log.
2. Run `plan` (read-only) to generate the plan file, which itself records
   the exact bounded ID list and every source field the compare-and-set
   will check - this file is retained as the primary lightweight record of
   "what we intended," in addition to the full `pg_dump`.
3. Run `execute --confirm`, which independently writes a result-log file
   recording, per row, the **before-state** (the row's accounting columns
   immediately prior to the write, fetched fresh at write time) and the
   **after-state** (exactly what was written) - this is the precise,
   row-level backup used for rollback (§17), distinct from and in addition
   to the full-database `pg_dump` checkpoint.

Both the plan file and the result-log file are excluded from git
(`scripts/backfill-runs/` - see `.gitignore`) because they contain real
financial data; they are local/operator-retained artifacts for this
specific execution, not repository content.

## 17. Exact rollback procedure

`rollback --result-log <path-to-that-run's-result-log> --confirm`. For
each row the given run recorded as `updated`, issues:

```sql
update transactions
set principal_effect_rwf = null, fee_effect_rwf = null, settlement_state = null,
    affects_balance = null, effect_reason = null
where id = <id>
  and principal_effect_rwf = <exactly what this run wrote>
  and fee_effect_rwf = <exactly what this run wrote>
  and settlement_state = <exactly what this run wrote>
  and affects_balance = <exactly what this run wrote>
  and effect_reason = <exactly what this run wrote>
returning id
```

This is **never** a broad `UPDATE ... WHERE settlement_state IS NOT NULL`
or similar - the rollback population is precisely the ID list in the given
result-log file, and each individual revert is itself compare-and-set: if
a row was touched again by something else after this run (e.g. a later,
separate Phase 4.1 rerun, or a hypothetical future Phase 4.2 process), it
is skipped rather than blindly reverted out from under that later change.

## 18. Accounting invariant verification procedure

Enforced at three independent layers, not just one:

1. **Local, pre-write**: `classifyRow()` recomputes `net_effect_rwf` via
   `computeAccountingEffect()` and compares it against the row's existing
   generated column value before ever proposing a write; a mismatch is
   classified `contradictory_partial_state` and excluded, never written.
2. **Database, at write time**: the existing
   `transactions_new_accounting_fields_all_or_nothing` and
   `transactions_net_effect_matches_new_accounting_fields` `CHECK`
   constraints (Phase 3) independently reject any write that would violate
   them, regardless of what the tool believes - a second, database-level
   backstop.
3. **Post-write** (to be run as part of production preflight/execute
   verification once authorized): an aggregate read-only query confirming
   the exact count of rows now holding `settlement_state IS NOT NULL`
   equals the pre-execution eligible count plus any legitimately-excluded
   rows remaining excluded - i.e. nothing was silently skipped or silently
   double-applied.

## 19. Expected post-execution state

For the current production population specifically: all 7 existing
transactions would move from `already_processed_count: 0` to
`already_processed_count: 7`, `eligible_count: 0` on the next `plan` run.
Concretely: 5 `out` rows get `affects_balance = true`,
`settlement_state = 'settled'`, and a negative `principal_effect_rwf`
(2 also with a negative `fee_effect_rwf`); 2 `in` rows get
`affects_balance = true`, `settlement_state = 'settled'`, and a positive
`principal_effect_rwf`; no row is excluded or requires manual review.

## 20. Remaining risks

- Production is live and could change before execution is actually
  authorized - §15's preflight must be re-run immediately before any
  future `execute`, not assumed still valid from this report.
- The backfill tool is not currently wired into CI (unlike the migration
  chain suite) - `scripts/tests/run_backfill_tests.sh` must be run
  manually before any future execution. Adding it to
  `.github/workflows/ci.yml` was considered but left out of this PR to
  keep Phase 4.1 discovery narrowly scoped; worth doing before Phase 4.2.
- `account_id` remains unpopulated by design (§5) - if a future
  multi-account phase needs it, that is a separate, explicit decision, not
  something this backfill silently assumes.
- The incoming-with-fee case remains genuinely unresolved (§12 of the
  numbered list below) - if MTN ever sends one, it will keep being
  excluded and flagged, not guessed at, until a real sample resolves it.

## Incoming transfer + nonzero fee (explicit check)

**0 such rows exist in production** (verified in §5 and independently in
§15). The documented dormant TS/SQL divergence (README.md "Known,
documented, dormant semantic gap") remains untested against real data and
is not being resolved here. If one appears in the future, this tool
excludes it automatically (`unsupported_incoming_with_fee`) rather than
processing it - no change to `computeAccountingEffect()` was made or is
proposed to accommodate this case by assumption.

## 21. Exact production command/process proposed (NOT executed)

When and if authorized, in order:

1. Take a fresh production backup checkpoint (§16 step 1).
2. `PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... PGDATABASE=... deno run --allow-net --allow-env --allow-read --allow-write --allow-sys scripts/phase-4-1-accounting-backfill.ts plan` -
   read-only, connected to the linked production project via an explicit,
   operator-supplied connection (never hardcoded, never committed).
3. Manual review of the resulting plan file against §2/§3/§5 above (should
   show 7 eligible, 0 excluded, matching this report exactly - if not,
   stop and investigate the discrepancy rather than proceeding).
4. `... execute --plan <path-from-step-2> --confirm` - the only step that
   writes.
5. Post-write verification per §18.3.
6. Retain both the `pg_dump` checkpoint and the plan/result-log files
   (outside git) for this execution.

**This has not been run. No step above has been executed against
production. Waiting for explicit authorization before step 1.**
