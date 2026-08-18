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
  'principal_effect_rwf + fee_effect_rwf, computed by the canonical accounting engine. Never populate this by any means other than that engine. Same NULL invariant: null means unprocessed, never zero.';
comment on column public.transactions.settlement_state is
  'Deterministic settlement classification independent of raw MTN status text: settled | failed | pending | reversed | unknown. Null means unprocessed - this is the recommended column to check (IS NOT NULL) before treating a row as accounting-complete.';
comment on column public.transactions.affects_balance is
  'Whether this transaction should be included when computing authoritative running/reconciled balances. Null means unprocessed (not "excluded"); must be false for anything not settlement_state = settled once processed. See constraint transactions_accounting_effect_all_or_nothing.';
comment on column public.transactions.effect_reason is
  'Short machine-readable explanation code for the computed effect (e.g. settled_outgoing_with_fee, failed_transaction_no_settlement), for auditability. Null until processed.';

-- Invariant (Phase 14), single all-or-nothing constraint. NULL means "not
-- yet processed by the accounting engine" and must never be confused with
-- a computed zero effect - so all five accounting columns must be either
-- entirely unset or entirely set together (an earlier draft of this
-- migration used two separate CHECK constraints for net=principal+fee and
-- for affects_balance/settlement_state agreement; those could each pass
-- independently while jointly allowing an invalid row, e.g.
-- affects_balance = true with net_effect_rwf still NULL. This single
-- constraint closes that gap):
--   - all five NULL: unprocessed.
--   - all five NOT NULL, and:
--       - net_effect_rwf = principal_effect_rwf + fee_effect_rwf
--       - affects_balance = (settlement_state = 'settled')
--       - any non-settled state carries an exact zero effect, matching
--         computeAccountingEffect's noEffect() helper precisely.
alter table public.transactions
  add constraint transactions_accounting_effect_all_or_nothing check (
    (
      principal_effect_rwf is null
      and fee_effect_rwf is null
      and net_effect_rwf is null
      and settlement_state is null
      and affects_balance is null
    )
    or (
      principal_effect_rwf is not null
      and fee_effect_rwf is not null
      and net_effect_rwf is not null
      and settlement_state is not null
      and affects_balance is not null
      and net_effect_rwf = principal_effect_rwf + fee_effect_rwf
      and affects_balance = (settlement_state = 'settled')
      and (
        settlement_state = 'settled'
        or (principal_effect_rwf = 0 and fee_effect_rwf = 0 and net_effect_rwf = 0)
      )
    )
  );

create index idx_transactions_account_id on public.transactions (account_id);
create index idx_transactions_settlement_state on public.transactions (settlement_state);
