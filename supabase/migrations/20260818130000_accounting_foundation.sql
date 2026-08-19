-- Accounting foundation: accounts table (multi-account readiness) and
-- deterministic accounting-effect enrichment columns on transactions.
--
-- This migration is purely additive:
--   - No existing column is altered or dropped.
--   - No existing row's amount_rwf, fee_rwf, balance_after_rwf, direction,
--     or status values are touched.
--   - New enrichment columns are added NULLABLE with no default and no
--     backfill, so existing rows and the current ingest-momo Edge Function
--     behavior are unaffected. Populating them for existing/new rows is a
--     future application-level step (out of scope for this migration),
--     performed by the single canonical accounting engine in
--     supabase/functions/_shared/accounting.ts - never recomputed in SQL,
--     so financial logic stays in one place.
--
-- Not applied to the linked project by writing this file. Review and run
-- `supabase db push` separately, deliberately, when ready.
--
-- DEPLOY ORDER NOTE: this migration assumes 20260818000000_baseline_
-- existing_schema.sql's objects (public.transactions, public.
-- set_updated_at()) already exist. On the current linked project they do
-- (created out-of-band), but `supabase migration list` shows no migration
-- history recorded there yet - see that file's header for why it must be
-- reconciled via `supabase migration repair` before any `db push`.

-- ===========================================================================
-- accounts: minimal multi-account readiness.
-- ===========================================================================
--
-- Today every transaction originates from a single MTN Mobile Money
-- account, so there is exactly one seeded row. This table exists so a
-- future bank account, card, cash wallet, or a second mobile-money
-- provider can be added without a breaking schema change later - it is not
-- wired into any ingestion or reporting logic yet.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null check (provider in ('mtn_momo', 'bank', 'card', 'cash', 'other')),
  currency char(3) not null default 'RWF' check (currency = upper(currency)),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.accounts is
  'Financial accounts this system tracks. Currently seeded with a single MTN MoMo account; reserved for future bank/card/cash/other-provider accounts. Not yet referenced by ingestion logic.';

create trigger set_accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

alter table public.accounts enable row level security;

-- Least privilege: only the service role (used exclusively by trusted
-- server-side code, e.g. Edge Functions) may read or write accounts. No
-- policy is added for anon/authenticated, so RLS denies them by default
-- even though Postgres default privileges may otherwise grant them table-
-- level access (see the existing four tables, which follow the same
-- deny-by-RLS pattern).
revoke all on public.accounts from anon, authenticated;
grant select, insert, update, delete on public.accounts to service_role;

insert into public.accounts (name, provider, currency)
values ('MTN MoMo (Primary)', 'mtn_momo', 'RWF');

-- ===========================================================================
-- transactions: accounting-effect enrichment (nullable, additive only)
-- ===========================================================================

alter table public.transactions
  add column account_id uuid references public.accounts(id),
  add column principal_effect_rwf bigint,
  add column fee_effect_rwf bigint,
  add column settlement_state text
    check (settlement_state is null or settlement_state in ('settled', 'failed', 'pending', 'reversed', 'unknown')),
  add column affects_balance boolean,
  add column effect_reason text;

comment on column public.transactions.account_id is
  'Reserved for future multi-account support. Nullable and unused by the current single-account ingestion flow.';
comment on column public.transactions.principal_effect_rwf is
  'Signed cash movement excluding fee, computed by the canonical accounting engine (supabase/functions/_shared/accounting.ts). NULL INVARIANT: null means "not yet processed by the accounting engine" - it never means a computed zero effect. A genuinely zero-effect settled transaction stores an explicit 0, not null. Never read this column as `?? 0`; check settlement_state IS NOT NULL (or all five accounting columns together) first.';
comment on column public.transactions.fee_effect_rwf is
  'Signed fee movement (<= 0), computed by the canonical accounting engine. Same NULL invariant as principal_effect_rwf: null means unprocessed, never zero.';
comment on column public.transactions.net_effect_rwf is
  'PRE-EXISTING GENERATED COLUMN (GENERATED ALWAYS AS (...) STORED, defined before this migration - see 20260818000000_baseline_existing_schema.sql). Computed automatically by Postgres from status/direction/amount_rwf/fee_rwf on every row and can never be NULL, unlike the five accounting-state columns above. Deliberately NOT part of the transactions_new_accounting_fields_all_or_nothing invariant for that reason - see the comment on that constraint and on transactions_net_effect_matches_new_accounting_fields below. Never attempt to INSERT or UPDATE this column directly; Postgres rejects that for a GENERATED ALWAYS column.';
comment on column public.transactions.settlement_state is
  'Deterministic settlement classification independent of raw MTN status text: settled | failed | pending | reversed | unknown. Null means unprocessed - this is the recommended column to check (IS NOT NULL) before treating a row as accounting-complete.';
comment on column public.transactions.affects_balance is
  'Whether this transaction should be included when computing authoritative running/reconciled balances. Null means unprocessed (not "excluded"); must be false for anything not settlement_state = settled once processed. See constraint transactions_new_accounting_fields_all_or_nothing.';
comment on column public.transactions.effect_reason is
  'Short machine-readable explanation code for the computed effect (e.g. settled_outgoing_with_fee, failed_transaction_no_settlement), for auditability. Null until processed.';

-- ---------------------------------------------------------------------------
-- Invariant, corrected after production rollout revealed a design flaw in an
-- earlier draft of this migration (see git history / Phase 3 remediation
-- notes): net_effect_rwf is a PRE-EXISTING GENERATED ALWAYS AS (...) STORED
-- column (defined in 20260818000000_baseline_existing_schema.sql, long
-- before this migration), computed by Postgres from status/direction/
-- amount_rwf/fee_rwf on every row. It can NEVER be NULL - not for existing
-- rows, not for any future row - because those inputs are all NOT NULL.
--
-- The original draft of this migration incorrectly grouped net_effect_rwf
-- together with the five genuinely-new, ordinary-nullable accounting
-- columns under one "all NULL or all populated" constraint. That is
-- unsatisfiable by ANY row, past or future: net_effect_rwf is always
-- non-null the instant a row exists, while the five new columns correctly
-- start NULL (unprocessed) on every fresh insert - so the "all NULL"
-- branch could never hold, and every single insert against the corrected
-- schema would have violated the constraint immediately. This was caught
-- before deployment when `supabase db push` failed against production's
-- existing rows; see 20260818130000's git history for the full
-- investigation. It was not a legacy-data problem - no backfill could ever
-- have fixed it, because the flaw was in the constraint's shape, not the
-- data.
--
-- Corrected design: two constraints.
--
-- 1. transactions_new_accounting_fields_all_or_nothing governs ONLY the
--    five ordinary-nullable columns this migration adds
--    (principal_effect_rwf, fee_effect_rwf, settlement_state,
--    affects_balance, effect_reason). NULL means "not yet processed by the
--    accounting engine" and must never be confused with a computed zero
--    effect - so these five must be either entirely unset or entirely set
--    together, consistently:
--      - all five NULL: unprocessed.
--      - all five NOT NULL, and:
--          - affects_balance = (settlement_state = 'settled')
--          - any non-settled state carries an exact zero effect
--            (principal_effect_rwf = 0 and fee_effect_rwf = 0), matching
--            computeAccountingEffect's noEffect() helper precisely.
--
-- 2. transactions_net_effect_matches_new_accounting_fields separately
--    cross-checks the pre-existing generated net_effect_rwf against the
--    new columns, but ONLY once they are populated - never requiring
--    net_effect_rwf itself to be null:
--      principal_effect_rwf IS NULL OR net_effect_rwf = principal_effect_rwf + fee_effect_rwf
--
--    This constraint also protects against ever marking a row "processed"
--    with a principal/fee split that disagrees with what Postgres already
--    computed for net_effect_rwf - see the PostgreSQL vs TypeScript
--    semantic comparison in supabase/functions/_shared/accounting.ts for
--    the one currently-dormant case (incoming money with a nonzero fee)
--    where the two formulas are not proven equivalent. Because of this
--    constraint, any future attempt to backfill accounting columns for a
--    row shaped like that dormant case would be rejected outright rather
--    than silently accepted with mismatched numbers - forcing an explicit
--    decision on that domain rule before such a row could ever be marked
--    processed, instead of a silent divergence.
-- Defense-in-depth notes on the "populated" branch below (added under
-- adversarial review, not required to fix the original bug but closing
-- gaps a determined reviewer should flag):
--   - fee_effect_rwf <= 0: a fee is always a cost; matches
--     computeAccountingEffect()'s negateRwf(fee_rwf)/0 result and catches
--     a sign-flipped fee that would otherwise only be caught (sometimes)
--     by coincidence via the net_effect_rwf cross-check.
--   - principal_effect_rwf's sign is checked against `direction` (an
--     existing, already-NOT-NULL column on this same row) whenever
--     settled: <= 0 for "out", >= 0 for "in", exactly 0 for "neutral" -
--     matching computeAccountingEffect()'s three direction branches
--     exactly. Skipped entirely when not settled, since the clause above
--     already pins principal_effect_rwf to exactly 0 in that case
--     regardless of direction.
alter table public.transactions
  add constraint transactions_new_accounting_fields_all_or_nothing check (
    (
      principal_effect_rwf is null
      and fee_effect_rwf is null
      and settlement_state is null
      and affects_balance is null
      and effect_reason is null
    )
    or (
      principal_effect_rwf is not null
      and fee_effect_rwf is not null
      and settlement_state is not null
      and affects_balance is not null
      and effect_reason is not null
      and fee_effect_rwf <= 0
      and affects_balance = (settlement_state = 'settled')
      and (
        settlement_state = 'settled'
        or (principal_effect_rwf = 0 and fee_effect_rwf = 0)
      )
      and (
        settlement_state <> 'settled'
        or direction <> 'out'
        or principal_effect_rwf <= 0
      )
      and (
        settlement_state <> 'settled'
        or direction <> 'in'
        or principal_effect_rwf >= 0
      )
      and (
        settlement_state <> 'settled'
        or direction <> 'neutral'
        or principal_effect_rwf = 0
      )
    )
  );

-- Self-contained on purpose: does not merely rely on
-- transactions_new_accounting_fields_all_or_nothing already having
-- guaranteed fee_effect_rwf is not null whenever principal_effect_rwf is
-- not null. Postgres CHECK constraints pass on both TRUE and NULL results
-- (only FALSE rejects) - had this been written as just
-- `principal_effect_rwf is null or net_effect_rwf = principal_effect_rwf + fee_effect_rwf`,
-- a hypothetical row with principal_effect_rwf populated but
-- fee_effect_rwf NULL would make the addition evaluate to NULL, which
-- CHECK treats as a pass, not a rejection. Requiring fee_effect_rwf is
-- not null explicitly closes that three-valued-logic gap, independent of
-- whatever the other constraint enforces.
alter table public.transactions
  add constraint transactions_net_effect_matches_new_accounting_fields check (
    principal_effect_rwf is null
    or (
      fee_effect_rwf is not null
      and net_effect_rwf = principal_effect_rwf + fee_effect_rwf
    )
  );

create index idx_transactions_account_id on public.transactions (account_id);
create index idx_transactions_settlement_state on public.transactions (settlement_state);
