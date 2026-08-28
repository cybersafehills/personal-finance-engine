-- Phase T (PR3): shared goals as first-class Space resources.
--
-- financial_goals (Phase D) is already workspace-scoped, but its write
-- surface is Owner-only and it has no notion of who is participating, a
-- linked account, or a recurring contribution expectation (master prompt
-- §26). This migration:
--
--   1. re-issues financial_goals / goal_contributions write policies from
--      Owner-only to the capability model (goal.manage for goal edits;
--      any member may contribute) - the same swap Phase S PR2d did for
--      member management. Behaviour is unchanged for personal workspaces
--      (has_space_capability = Owner-only there).
--   2. adds financial_goals.linked_account_id and
--      .monthly_contribution_target_minor (both nullable, additive).
--   3. adds goal_participants (which members are in on a goal).
--   4. adds set_goal_participants() and goal_progress() (the §26 computed
--      metrics, as one SQL source of truth for web and future reports).

-- ===========================================================================
-- Policy re-issues. drop + create; grants unchanged.
-- ===========================================================================

drop policy financial_goals_write_owner on public.financial_goals;
create policy financial_goals_write_manager on public.financial_goals
  for insert to authenticated
  with check (public.has_space_capability(workspace_id, 'goal.manage'));

drop policy financial_goals_update_owner on public.financial_goals;
create policy financial_goals_update_manager on public.financial_goals
  for update to authenticated
  using (public.has_space_capability(workspace_id, 'goal.manage'))
  with check (public.has_space_capability(workspace_id, 'goal.manage'));

-- refresh_goal_current_amount (Phase D) fires from a goal_contributions
-- trigger and UPDATEs financial_goals. As a plain (non-SECURITY DEFINER)
-- trigger it ran with the contributor's own privileges - fine while only
-- an Owner could contribute, but now that any member can, that member
-- lacks goal.manage and the re-issued financial_goals_update_manager
-- policy would silently filter the recompute to zero rows. Re-issue it
-- SECURITY DEFINER so the authoritative sum is always maintained,
-- matching its own comment ("maintained exclusively by this function,
-- never written directly by application code").
create or replace function public.refresh_goal_current_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_goal_id uuid := coalesce(new.goal_id, old.goal_id);
begin
  update public.financial_goals
  set current_amount_minor = (
    select coalesce(sum(amount_minor), 0)
    from public.goal_contributions
    where goal_id = affected_goal_id
  )
  where id = affected_goal_id;

  return null;
end;
$$;

revoke all on function public.refresh_goal_current_amount() from public;

-- Any active member may record a contribution (master prompt §7: "participate
-- in goals"). Removing one stays with a goal manager or the person who
-- entered it.
drop policy goal_contributions_write_owner on public.goal_contributions;
create policy goal_contributions_write_member on public.goal_contributions
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'member'));

drop policy goal_contributions_delete_owner on public.goal_contributions;
create policy goal_contributions_delete_manager on public.goal_contributions
  for delete to authenticated
  using (
    public.has_space_capability(workspace_id, 'goal.manage')
    or created_by = auth.uid()
  );

-- ===========================================================================
-- financial_goals: linked account + recurring contribution expectation.
-- ===========================================================================

alter table public.financial_goals
  add column linked_account_id uuid references public.accounts (id),
  add column monthly_contribution_target_minor bigint
    check (monthly_contribution_target_minor is null
           or monthly_contribution_target_minor >= 0);

comment on column public.financial_goals.linked_account_id is
  'Optional: the account contributions to this goal are expected to come from. Presentational - not enforced against goal_contributions.';
comment on column public.financial_goals.monthly_contribution_target_minor is
  'Optional: the recurring monthly contribution the members intend to make - used by goal_progress() as the "expected rate" alongside the observed rate.';

-- ===========================================================================
-- goal_participants: which Space members are in on a shared goal.
-- ===========================================================================

create table public.goal_participants (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.financial_goals (id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint goal_participants_unique unique (goal_id, user_id),
  constraint goal_participants_goal_same_workspace
    foreign key (workspace_id, goal_id)
    references public.financial_goals (workspace_id, id)
);

comment on table public.goal_participants is
  'Which active members of a Space are participating in a goal. Advisory (a non-participant member can still contribute) - it drives who a goal-contribution notification goes to and how the goal is framed in reports. Written only by set_goal_participants().';

create index idx_goal_participants_goal on public.goal_participants (goal_id);

alter table public.goal_participants enable row level security;

create policy goal_participants_select_member on public.goal_participants
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.goal_participants from anon;
grant select on public.goal_participants to authenticated;
grant select, insert, update, delete on public.goal_participants to service_role;

-- ===========================================================================
-- set_goal_participants: replace the participant set for a goal.
-- goal.manage-gated; validates every id is an active member; audited.
-- ===========================================================================

create or replace function public.set_goal_participants(
  p_goal_id uuid,
  p_user_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_bad integer;
begin
  select workspace_id into v_ws from public.financial_goals where id = p_goal_id;
  if v_ws is null then
    raise exception 'Goal not found.';
  end if;

  if not public.has_space_capability(v_ws, 'goal.manage') then
    raise exception 'You do not have permission to manage goals in this Space.';
  end if;

  select count(*) into v_bad
  from unnest(coalesce(p_user_ids, array[]::uuid[])) as u(uid)
  where not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = v_ws and m.user_id = u.uid and m.status = 'active'
  );
  if v_bad > 0 then
    raise exception 'A participant list names % person(s) who are not active members of this Space.', v_bad;
  end if;

  delete from public.goal_participants
  where goal_id = p_goal_id
    and (p_user_ids is null or user_id <> all(p_user_ids));

  insert into public.goal_participants (goal_id, workspace_id, user_id, added_by)
  select p_goal_id, v_ws, u.uid, auth.uid()
  from unnest(coalesce(p_user_ids, array[]::uuid[])) as u(uid)
  on conflict (goal_id, user_id) do nothing;

  perform public.record_space_audit_event(
    v_ws, 'goal.participants_changed', 'financial_goal', p_goal_id, null,
    jsonb_build_object('participant_count', coalesce(array_length(p_user_ids, 1), 0)));
end;
$$;

revoke all on function public.set_goal_participants(uuid, uuid[]) from public;
grant execute on function public.set_goal_participants(uuid, uuid[]) to authenticated;

-- ===========================================================================
-- goal_progress: the §26 computed metrics for one goal, readable by any
-- active member of its Space. SECURITY DEFINER / STABLE.
--   required_monthly_minor  - what's needed per month to hit target_date
--   recent_monthly_rate_minor - observed contribution rate over 90 days
--   projected_completion_date - current_date extended by remaining / rate
-- ===========================================================================

create or replace function public.goal_progress(p_goal_id uuid)
returns table (
  target_minor bigint,
  current_minor bigint,
  pct_complete numeric,
  target_date date,
  months_to_target numeric,
  required_monthly_minor bigint,
  recent_monthly_rate_minor bigint,
  projected_completion_date date
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  g public.financial_goals%rowtype;
  v_remaining bigint;
  v_months numeric;
  v_rate bigint;
begin
  select * into g from public.financial_goals where id = p_goal_id;
  if not found then
    return;
  end if;
  if not public.is_workspace_member(g.workspace_id) then
    return;
  end if;

  v_remaining := greatest(g.target_amount_minor - g.current_amount_minor, 0);

  if g.target_date is not null then
    v_months := round((g.target_date - current_date)::numeric / 30.4375, 2);
  end if;

  select coalesce(sum(amount_minor), 0) / 3
    into v_rate
  from public.goal_contributions
  where goal_id = p_goal_id
    and contribution_date >= current_date - interval '90 days';

  return query
  select
    g.target_amount_minor,
    g.current_amount_minor,
    case when g.target_amount_minor > 0
      then least(round(g.current_amount_minor::numeric * 100 / g.target_amount_minor, 1), 100)
      else 0 end,
    g.target_date,
    v_months,
    case
      when v_months is not null and v_months > 0 and v_remaining > 0
        then ceil(v_remaining::numeric / v_months)::bigint
      else 0::bigint
    end,
    v_rate,
    case
      when v_remaining <= 0 then current_date
      when v_rate > 0
        then current_date + (ceil(v_remaining::numeric / v_rate) * 30.4375)::integer
      else null
    end;
end;
$$;

revoke all on function public.goal_progress(uuid) from public;
grant execute on function public.goal_progress(uuid) to authenticated, service_role;
