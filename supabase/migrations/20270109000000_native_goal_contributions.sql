-- The mobile form records funds already set aside. It never posts a ledger entry.
alter table public.client_operations drop constraint client_operations_op_type_check;
alter table public.client_operations add constraint client_operations_op_type_check
  check (op_type in ('create_manual_transaction', 'set_category', 'record_goal_contribution'));

-- Serialize recomputations even for older web clients writing directly.
create or replace function public.refresh_goal_current_amount()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  affected_goal_id uuid := coalesce(new.goal_id, old.goal_id);
begin
  perform 1 from public.financial_goals where id = affected_goal_id for no key update;
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

create function public.record_goal_contribution(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_goal_id uuid,
  p_currency text,
  p_amount_minor bigint,
  p_contribution_date date
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  goal public.financial_goals;
  previous public.client_operations;
  payload jsonb;
begin
  if actor is null or not public.is_workspace_member(p_workspace_id, 'member') then
    raise exception 'goal_not_found' using errcode = 'P0002';
  end if;
  if p_operation_id is null or p_currency is null or p_currency not in ('RWF', 'USD', 'EUR')
    or p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > 9007199254740991
    or p_contribution_date is null or p_contribution_date > (now() at time zone 'Africa/Kigali')::date
    or p_contribution_date < date '0001-01-01' then
    raise exception 'invalid_contribution' using errcode = '22023';
  end if;

  payload := jsonb_build_object('workspace_id', p_workspace_id, 'currency', p_currency,
    'amount_minor', p_amount_minor, 'date', p_contribution_date);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text, 0));
  select * into previous from public.client_operations where op_id = p_operation_id;
  if found then
    if previous.user_id <> actor or previous.op_type <> 'record_goal_contribution'
      or previous.entity_id is distinct from p_goal_id or previous.result <> payload then
      raise exception 'operation_conflict' using errcode = '22023';
    end if;
    return 'replayed';
  end if;

  select * into goal from public.financial_goals
    where id = p_goal_id and workspace_id = p_workspace_id for no key update;
  if not found or goal.status <> 'active' then
    raise exception 'goal_not_found' using errcode = 'P0002';
  end if;
  if goal.currency <> p_currency or goal.current_amount_minor::numeric + p_amount_minor > 9007199254740991 then
    raise exception 'invalid_contribution' using errcode = '22023';
  end if;

  insert into public.goal_contributions
    (goal_id, workspace_id, amount_minor, contribution_date, source, created_by)
  values (goal.id, p_workspace_id, p_amount_minor, p_contribution_date, 'manual', actor);
  insert into public.client_operations (op_id, user_id, op_type, entity_id, result)
  values (p_operation_id, actor, 'record_goal_contribution', goal.id, payload);
  return 'recorded';
end;
$$;

revoke all on function public.record_goal_contribution(uuid, uuid, uuid, text, bigint, date) from public, anon;
grant execute on function public.record_goal_contribution(uuid, uuid, uuid, text, bigint, date) to authenticated;
