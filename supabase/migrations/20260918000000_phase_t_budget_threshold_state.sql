-- Phase T (PR2): budget threshold-crossing state.
--
-- web/lib/budget-math.ts computes alerts fresh on every read and
-- deliberately does not persist them - "since that's real notification
-- infrastructure this project doesn't have yet" (its own comment). This
-- is that infrastructure: one row per (budget, scope) recording the last
-- threshold bucket a periodic job saw, so a Phase V job emits ONE alert
-- per upward crossing instead of one per transaction (master prompt §25).
-- Pairs with should_notify() from Phase T PR1.
--
-- Service-role-only plumbing: no authenticated grant, no user surface.
-- Additive - one table, two functions.

-- Buckets, ascending:
--   ok       < 75%
--   watch    75-89%   (§25 "heads-up")
--   at_risk  90-99%   (§25 "warning")
--   exceeded 100-109% (§25 "exceeded")
--   over     >= 110%  (§25 "significant overspend")

create or replace function public.budget_bucket_for_percent(p_percent numeric)
returns text
language sql
immutable
as $$
  select case
    when p_percent is null then 'ok'
    when p_percent >= 110 then 'over'
    when p_percent >= 100 then 'exceeded'
    when p_percent >= 90  then 'at_risk'
    when p_percent >= 75  then 'watch'
    else 'ok'
  end;
$$;

comment on function public.budget_bucket_for_percent is
  'Maps a spend percentage to a threshold bucket (ok < watch < at_risk < exceeded < over). Pure/IMMUTABLE; used by record_budget_threshold_crossing.';

revoke all on function public.budget_bucket_for_percent(numeric) from public;

create table public.budget_threshold_state (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  -- a budget_allocations.allocation_type, or '__total__' for the
  -- whole-budget threshold.
  scope text not null,
  last_bucket text not null default 'ok'
    check (last_bucket in ('ok', 'watch', 'at_risk', 'exceeded', 'over')),
  last_crossed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_threshold_state_unique unique (budget_id, scope)
);

comment on table public.budget_threshold_state is
  'One row per (budget, scope) tracking the last threshold bucket a periodic job observed, so an alert fires once per upward crossing rather than once per transaction. Service-role-only - written exclusively by record_budget_threshold_crossing().';

create index idx_budget_threshold_state_budget on public.budget_threshold_state (budget_id);

create trigger set_budget_threshold_state_updated_at
  before update on public.budget_threshold_state
  for each row execute function public.set_updated_at();

alter table public.budget_threshold_state enable row level security;

revoke all on public.budget_threshold_state from anon;
grant select, insert, update, delete on public.budget_threshold_state to service_role;

-- record_budget_threshold_crossing: given the current spend percentage for
-- one budget scope, upsert the tracked bucket and return the NEW bucket
-- name IFF it is a strictly HIGHER bucket than last seen (an upward
-- crossing that warrants exactly one alert). A same-or-lower bucket
-- updates the stored state silently and returns NULL - so spending that
-- drops back and later climbs again produces a fresh alert.
create or replace function public.record_budget_threshold_crossing(
  p_budget_id uuid,
  p_scope text,
  p_percent numeric
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order text[] := array['ok', 'watch', 'at_risk', 'exceeded', 'over'];
  v_new_bucket text := public.budget_bucket_for_percent(p_percent);
  v_old_bucket text;
  v_upward boolean;
begin
  select last_bucket into v_old_bucket
  from public.budget_threshold_state
  where budget_id = p_budget_id and scope = p_scope;

  v_old_bucket := coalesce(v_old_bucket, 'ok');
  v_upward := array_position(v_order, v_new_bucket) > array_position(v_order, v_old_bucket);

  insert into public.budget_threshold_state (budget_id, scope, last_bucket, last_crossed_at)
  values (p_budget_id, p_scope, v_new_bucket, now())
  on conflict (budget_id, scope) do update
    set last_bucket = excluded.last_bucket,
        last_crossed_at = case
          when array_position(v_order, excluded.last_bucket)
             > array_position(v_order, budget_threshold_state.last_bucket)
          then now()
          else budget_threshold_state.last_crossed_at
        end;

  if v_upward then
    return v_new_bucket;
  end if;
  return null;
end;
$$;

comment on function public.record_budget_threshold_crossing is
  'Records the current bucket for (budget, scope) and returns the new bucket name only on a strictly upward crossing (one alert per crossing, not per transaction). Service-role-only - the Phase V periodic job is the only caller.';

revoke all on function public.record_budget_threshold_crossing(uuid, text, numeric) from public;
grant execute on function public.record_budget_threshold_crossing(uuid, text, numeric) to service_role;
