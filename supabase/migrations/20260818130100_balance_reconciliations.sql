-- Balance reconciliation storage: one evaluation record per transaction,
-- upserted by transaction_id so repeated processing is idempotent and
-- never creates duplicate reconciliation records.
--
-- Not applied to the linked project by writing this file. Review and run
-- `supabase db push` separately, deliberately, when ready.

create table public.balance_reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  expected_balance_rwf bigint,
  reported_balance_rwf bigint,
  difference_rwf bigint,
  status text not null check (status in ('reconciled', 'mismatch', 'insufficient_data', 'pending_review')),
  reason text not null,
  calculated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint balance_reconciliations_transaction_unique unique (transaction_id),
  constraint balance_reconciliations_difference_consistent check (
    difference_rwf is null
    or (
      expected_balance_rwf is not null
      and reported_balance_rwf is not null
      and difference_rwf = reported_balance_rwf - expected_balance_rwf
    )
  ),
  -- A "reconciled", "mismatch", or "pending_review" verdict is only
  -- meaningful backed by complete numeric evidence - matching how the
  -- reconciliation engine (reconciliation.ts) always populates these
  -- checkpoints. Only "insufficient_data" may legitimately have partial or
  -- entirely null figures (e.g. a missing reported balance, or a
  -- non-settling transaction).
  constraint balance_reconciliations_status_requires_evidence check (
    status = 'insufficient_data'
    or (
      expected_balance_rwf is not null
      and reported_balance_rwf is not null
      and difference_rwf is not null
    )
  )
);

comment on table public.balance_reconciliations is
  'One reconciliation evaluation per transaction, produced by the canonical reconciliation engine (supabase/functions/_shared/reconciliation.ts). Upserted by transaction_id so repeated processing is idempotent. reported_balance_rwf is a copy of transactions.balance_after_rwf captured at evaluation time for a self-contained audit record - transactions.balance_after_rwf remains the single source of truth and must never be overwritten with a calculated value.';
comment on column public.balance_reconciliations.expected_balance_rwf is
  'Our calculated running balance immediately after this transaction, or null when there was insufficient prior evidence to calculate one.';
comment on column public.balance_reconciliations.reported_balance_rwf is
  'Copy of the MTN-reported balance_after_rwf for this transaction at evaluation time, or null if this transaction reported no balance.';
comment on column public.balance_reconciliations.status is
  'reconciled: expected matches reported. mismatch: they disagree. insufficient_data: not enough evidence to compare (e.g. missing balance, no opening checkpoint, non-settling transaction). pending_review: an earlier unresolved pending transaction makes this checkpoint provisional.';
comment on column public.balance_reconciliations.calculated_at is
  'When this evaluation was computed by the reconciliation engine. Supplied explicitly by the caller (not defaulted here) so the recorded time reflects the actual computation rather than row-write time, keeping the engine itself free of wall-clock reads.';

create trigger set_balance_reconciliations_updated_at
  before update on public.balance_reconciliations
  for each row execute function public.set_updated_at();

create index idx_balance_reconciliations_account_id on public.balance_reconciliations (account_id);
create index idx_balance_reconciliations_status on public.balance_reconciliations (status);

alter table public.balance_reconciliations enable row level security;

-- Least privilege, matching every other table in this schema: only the
-- service role may access reconciliation results. Financial reconciliation
-- data must never be reachable via anon/authenticated.
revoke all on public.balance_reconciliations from anon, authenticated;
grant select, insert, update, delete on public.balance_reconciliations to service_role;
