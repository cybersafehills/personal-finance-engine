-- OneLedger 3.0 S3: balance provenance (docs/oneledger-3/architecture.md,
-- migration.md). ADDITIVE ONLY: no existing table/column is altered.
--
-- Design decision (revises migration.md): provider-reported balances stay on
-- transactions.balance_after_rwf, which remains the single source of truth
-- (see balance_reconciliations comment). They are NOT copied into a second
-- table, so there is nothing to backfill or keep in sync. This migration adds:
--   1. balance_observations  - USER-ENTERED ("manual") balance statements only,
--      with provenance, written solely through an audited RPC.
--   2. account_balance_baselines_v - a security_invoker view picking, per
--      account, the latest trustworthy baseline (provider-reported or manual)
--      plus what has happened since. Status (confirmed/estimated/stale/
--      unavailable) is DERIVED in application code (web/lib/balance-status.ts)
--      from this view; estimates are never stored, so they can never be
--      mistaken for observations.

create table public.balance_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null,
  -- Balance in the account's currency minor units (RWF scale 0). May be
  -- negative (overdrawn bank account); wallets report >= 0.
  amount_minor bigint not null,
  currency char(3) not null check (currency = upper(currency)),
  as_of timestamptz not null,
  source text not null default 'manual' check (source in ('manual')),
  note text check (note is null or length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint balance_observations_account_same_workspace
    foreign key (workspace_id, account_id)
    references public.accounts (workspace_id, id) on delete cascade
);

create index idx_balance_observations_account_asof
  on public.balance_observations (account_id, as_of desc, created_at desc);
create index idx_balance_observations_workspace
  on public.balance_observations (workspace_id);

comment on table public.balance_observations is
  'User-entered balance statements for an account (manual reconciliation). Provider-reported balances live on transactions.balance_after_rwf and are not duplicated here. Append-only: no update/delete grant; corrections are new rows. Written only by record_manual_balance_observation().';

alter table public.balance_observations enable row level security;

create policy balance_observations_select_member on public.balance_observations
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.balance_observations from anon, authenticated;
grant select on public.balance_observations to authenticated;
grant select, insert on public.balance_observations to service_role;

-- ---------------------------------------------------------------------------
-- record_manual_balance_observation: the only write path. Member+ of the
-- account's workspace; as_of may not be in the future; audited.
-- ---------------------------------------------------------------------------
create or replace function public.record_manual_balance_observation(
  p_account_id uuid,
  p_amount_minor bigint,
  p_as_of timestamptz,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_currency char(3);
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select workspace_id, currency into v_ws, v_currency
  from public.accounts where id = p_account_id;

  -- Same error for "no such account" and "not yours": no existence oracle.
  if v_ws is null or not public.is_workspace_member(v_ws, 'member') then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  if p_amount_minor is null or p_as_of is null then
    raise exception 'invalid_observation' using errcode = '22023';
  end if;
  if p_as_of > now() + interval '5 minutes' then
    raise exception 'as_of_in_future' using errcode = '22023';
  end if;

  insert into public.balance_observations
    (workspace_id, account_id, amount_minor, currency, as_of, note, created_by)
  values
    (v_ws, p_account_id, p_amount_minor, v_currency, p_as_of,
     nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;

  perform public.record_space_audit_event(
    v_ws, 'balance.manual_observation', 'account', p_account_id,
    null,
    jsonb_build_object('observation_id', v_id, 'amount_minor', p_amount_minor,
                       'currency', v_currency, 'as_of', p_as_of)
  );
  return v_id;
end;
$$;

comment on function public.record_manual_balance_observation is
  'Member+ records a user-stated balance for an account. Append-only, audited (space_audit_events). Never overwrites provider-reported balances.';

revoke all on function public.record_manual_balance_observation(uuid, bigint, timestamptz, text) from public;
grant execute on function public.record_manual_balance_observation(uuid, bigint, timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- account_balance_baselines_v: per account, the newest baseline and the
-- activity since. security_invoker => the caller's RLS on transactions /
-- balance_observations / accounts applies (no cross-tenant leakage).
-- Provider baseline rule mirrors getCurrentBalance(): newest non-merged row
-- with balance_after_rwf, skipping an impossible "received" row whose own
-- balance line has not caught up with the credit.
-- A baseline's own transaction is excluded from "since" by (occurred_at,
-- created_at) ordering; rows at an identical instant resolve by created_at.
-- ---------------------------------------------------------------------------
create view public.account_balance_baselines_v
with (security_invoker = true) as
with provider as (
  select distinct on (t.account_id)
    t.account_id, t.workspace_id,
    t.balance_after_rwf as amount_minor,
    t.occurred_at as as_of, t.created_at as tiebreak
  from public.transactions t
  where t.balance_after_rwf is not null
    and t.dedupe_state <> 'merged'
    and not (t.direction = 'in' and t.principal_effect_rwf is not null
             and t.balance_after_rwf < t.principal_effect_rwf)
  order by t.account_id, t.occurred_at desc, t.created_at desc
),
manual as (
  select distinct on (o.account_id)
    o.account_id, o.workspace_id, o.amount_minor,
    o.as_of, o.created_at as tiebreak
  from public.balance_observations o
  order by o.account_id, o.as_of desc, o.created_at desc
),
baseline as (
  select distinct on (account_id)
    account_id, workspace_id, amount_minor, as_of, tiebreak, source
  from (
    select p.*, 'provider_reported'::text as source, 0 as pref from provider p
    union all
    select m.*, 'manual'::text as source, 1 as pref from manual m
  ) u
  -- newer as_of wins; on an exact tie the user's statement wins.
  order by account_id, as_of desc, pref desc
)
select
  a.id as account_id,
  a.workspace_id,
  a.currency,
  b.amount_minor as baseline_amount_minor,
  b.as_of as baseline_as_of,
  b.source as baseline_source,
  coalesce(s.txns_since_count, 0) as txns_since_count,
  coalesce(s.net_effect_since_minor, 0) as net_effect_since_minor,
  coalesce(s.unresolved_since_count, 0) as unresolved_since_count,
  coalesce(s.mismatch_since_count, 0) as mismatch_since_count,
  l.latest_txn_at
from public.accounts a
left join baseline b on b.account_id = a.id
left join lateral (
  select
    count(*) filter (where t.settlement_state = 'settled'
                     and t.affects_balance is true
                     and t.principal_effect_rwf is not null
                     and t.fee_effect_rwf is not null)            as txns_since_count,
    coalesce(sum(t.principal_effect_rwf + t.fee_effect_rwf) filter (
      where t.settlement_state = 'settled' and t.affects_balance is true
        and t.principal_effect_rwf is not null
        and t.fee_effect_rwf is not null), 0)                     as net_effect_since_minor,
    -- cannot be folded into an estimate: still pending/unknown, or missing
    -- accounting effects.
    count(*) filter (where t.settlement_state in ('pending', 'unknown')
                     or (t.settlement_state = 'settled'
                         and t.affects_balance is true
                         and (t.principal_effect_rwf is null
                              or t.fee_effect_rwf is null)))      as unresolved_since_count,
    count(*) filter (where r.status = 'mismatch')                 as mismatch_since_count
  from public.transactions t
  left join public.balance_reconciliations r on r.transaction_id = t.id
  where t.account_id = a.id
    and t.dedupe_state <> 'merged'
    and b.as_of is not null
    and (t.occurred_at, t.created_at) > (b.as_of, b.tiebreak)
) s on true
left join lateral (
  select max(t.occurred_at) as latest_txn_at
  from public.transactions t
  where t.account_id = a.id and t.dedupe_state <> 'merged'
) l on true
where a.archived_at is null;

comment on view public.account_balance_baselines_v is
  'Ingredients for the balance status label (web/lib/balance-status.ts): newest baseline (provider_reported or manual) per active account plus settled balance-affecting effect, unresolved and reconciliation-mismatch counts since it. security_invoker: RLS of the caller applies.';

grant select on public.account_balance_baselines_v to authenticated, service_role;
