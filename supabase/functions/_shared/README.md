# _shared: deterministic accounting layer

Pure, dependency-free TypeScript modules shared by Edge Functions. This
directory is prefixed with `_` so the Supabase CLI never deploys it as its own
function - it exists to be imported.

**Nothing here talks to Supabase, the network, or the system clock.** Every
function is a deterministic transformation of its input, independently testable
with `deno test`, and safe to unit test without a database.

## Why this exists

`transactions` rows already carry MTN's raw, evidence-preserving fields
(`amount_rwf`, `fee_rwf`, `direction`, `status`, `balance_after_rwf`, ...). This
layer answers the questions those raw fields can't answer directly: how much
cash actually moved, whether that movement should count toward authoritative
totals, and whether our calculated balance still agrees with what MTN itself
reported.

**AI/LLMs must never calculate authoritative financial totals, balances,
transaction effects, or reconciliation results.** This layer is the only place
those numbers are computed.

## Modules

- `types.ts` - shared vocabulary (`AccountingEffect`, `SettlementState`,
  `ReconciliationStatus`, ...).
- `money.ts` - RWF integer-arithmetic helpers. See the module comment for why
  plain `number` integers (not floats or bigint) are the correct exact
  representation here.
- `accounting.ts` - `computeAccountingEffect(input)`: given a transaction's
  `direction`, `status`, `amount_rwf`, and `fee_rwf`, deterministically returns
  its principal/fee/net effect, whether it affects the balance, and a settlement
  classification. **The single canonical place this calculation happens** - do
  not reimplement it in SQL, an Edge Function, or a frontend.
- `kigali-time.ts` - Africa/Kigali financial-day boundaries. Rwanda uses a fixed
  UTC+02:00 offset with no DST, so this needs no timezone database.
- `reconciliation.ts` - `reconcileTransactions(transactions, opening)`: walks a
  set of accounting-processed transactions in `occurred_at` order (never
  insertion order) and compares a running calculated balance against MTN's
  reported `balance_after_rwf` checkpoints.

## What this layer intentionally does NOT do (yet)

Per the current phase's scope, none of the following exist yet, even though this
layer is designed to eventually support them:

- Nothing here is invoked by any Edge Function, cron job, or scheduled process.
  `accounting.ts`/`reconciliation.ts` are pure functions waiting to be called by
  a future processing step.
- The new `transactions` enrichment columns (`principal_effect_rwf`,
  `fee_effect_rwf`, `settlement_state`, `affects_balance`, `effect_reason`,
  `account_id`) and the new `balance_reconciliations` table are additive schema
  only - no migration backfills existing rows, and `ingest-momo` does not
  populate them. See the migration files' header comments.
- No daily close, morning briefing, budgets, dashboards, or AI-generated
  explanations. Those are later phases.

## NULL invariant on the `transactions` enrichment columns

`principal_effect_rwf`, `fee_effect_rwf`, `settlement_state`, and
`affects_balance` (plus `effect_reason`) are nullable and unpopulated for
existing/new rows until a future processing step calls this engine. **NULL means
"not yet processed" and must never be read or treated as zero.** A genuinely
zero-effect settled transaction stores an explicit `0`/`false`/`'settled'`, not
`NULL`. Never write `row.principal_effect_rwf ?? 0` in future reporting code -
use `hasComputedAccountingEffect()` (`accounting.ts`) or check
`settlement_state IS NOT NULL` in SQL first. The database itself enforces this
as an all-or-nothing invariant over those five columns (see constraint
`transactions_new_accounting_fields_all_or_nothing` in
`20260818130000_accounting_foundation.sql`): either all five are NULL, or all
five are populated and mutually consistent - a partially populated row is
impossible.

**`net_effect_rwf` is intentionally NOT part of that group.** It is a
pre-existing `GENERATED ALWAYS AS (...) STORED` column (see
`20260818000000_baseline_existing_schema.sql`) that Postgres computes on every
row from `status`/`direction`/`amount_rwf`/`fee_rwf` - it can never be NULL, and
Postgres rejects writing it directly. A separate constraint,
`transactions_net_effect_matches_new_accounting_fields`, cross-checks it against
`principal_effect_rwf + fee_effect_rwf` only once those are populated. An
earlier draft of this migration incorrectly grouped `net_effect_rwf` into the
same nullable set as the other five - unsatisfiable by any row, ever, since it
is never null - and that mistake is exactly what caused the first production
`db push` attempt to fail. See `supabase/migrations/README.md`'s pre-migration
checklist and `20260818130000_accounting_foundation.sql`'s comments for the full
story.

## Defensive guards added under adversarial review

- `computeAccountingEffect` throws (rather than silently returning `undefined`
  or discarding data) for: an unrecognized `status` or `direction` value
  bypassing the type system at runtime, and a `"neutral"` direction paired with
  a nonzero amount (a contradictory input with no well-defined interpretation).
- `reconcileTransactions` throws if the same transaction `id` appears more than
  once in its input, rather than silently double-counting that transaction's
  effect against the running balance.

## Migrations in this phase

- `20260818000000_baseline_existing_schema.sql` - reconstructs the schema that
  already exists in the linked project (created out-of-band before this repo
  tracked migrations). Read its header before touching it - it must never be
  applied via a plain `db push` against the current project without first
  running `supabase migration repair`.
- `20260818130000_accounting_foundation.sql` - `accounts` table + nullable
  accounting-effect columns on `transactions`.
- `20260818130100_balance_reconciliations.sql` - reconciliation storage.
- `20260818130200_revoke_anon_authenticated_privileges.sql` - security
  hardening: removes unnecessary `anon`/`authenticated` table grants on every
  table in this schema (RLS already blocked them; this removes the redundant
  GRANT-level access too, for defense in depth).

## Known limitation: reversed transactions

`computeAccountingEffect` deliberately returns a zero effect for
`status: "reversed"` rather than guessing a compensating sign. No confirmed
real-world MTN Rwanda reversal SMS sample exists yet (see
`ingest-momo/README.md` "Unsupported formats"). Do not change this without a
real sample to verify the correct semantics against - see the comment in
`accounting.ts` for detail.

## Commands

```sh
# Format
deno fmt supabase/functions/_shared/

# Lint
deno lint supabase/functions/_shared/

# Type check
deno check supabase/functions/_shared/accounting.ts supabase/functions/_shared/reconciliation.ts supabase/functions/_shared/kigali-time.ts supabase/functions/_shared/money.ts supabase/functions/_shared/types.ts

# Run the accounting test suite (pure functions, no network/Supabase access)
deno test supabase/functions/_shared/tests/
```
