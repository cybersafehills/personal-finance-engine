alter table public.client_operations drop constraint client_operations_op_type_check;
alter table public.client_operations add constraint client_operations_op_type_check
  check (op_type in ('create_manual_transaction', 'set_category', 'record_goal_contribution', 'create_budget_draft'));

-- The draft and its allocations are committed together. The operation receipt
-- is durable even if the budget is later edited or archived.
create function public.create_budget_draft(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_name text,
  p_currency text,
  p_period_start date,
  p_period_end date,
  p_income_minor bigint,
  p_income_frequency text,
  p_percentages jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  existing public.client_operations;
  payload jsonb;
  annual_minor numeric;
  monthly_minor bigint;
  revision text;
begin
  if actor is null or not public.has_space_capability(p_workspace_id, 'budget.manage') then
    raise exception 'budget_edit_denied' using errcode = '42501';
  end if;
  if p_operation_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 80
    or p_currency is null or p_currency not in ('RWF', 'USD', 'EUR')
    or p_period_start is null or p_period_end is null
    or not isfinite(p_period_start) or not isfinite(p_period_end)
    or p_period_end <= p_period_start or p_period_start < date '0001-01-01' or p_period_end > date '9999-12-31'
    or p_income_minor is null or p_income_minor < 0
    or p_income_frequency is null or p_income_frequency not in ('weekly','biweekly','semimonthly','monthly','annual')
    or jsonb_typeof(p_percentages) is distinct from 'object' then
    raise exception 'invalid_budget_draft' using errcode = '22023';
  end if;

  -- Match normalizeIncome() in web/lib/budget-math.ts, including half-up.
  annual_minor := p_income_minor::numeric * case p_income_frequency
    when 'weekly' then 52 when 'biweekly' then 26 when 'semimonthly' then 24
    when 'monthly' then 12 else 1 end;
  if annual_minor > 9007199254740991 then
    raise exception 'invalid_budget_income' using errcode = '22023';
  end if;
  monthly_minor := div(annual_minor + 6, 12)::bigint;

  payload := jsonb_build_object('workspace_id', p_workspace_id, 'name', btrim(p_name),
    'currency', p_currency, 'period_start', p_period_start, 'period_end', p_period_end,
    'income_minor', p_income_minor, 'frequency', p_income_frequency, 'percentages', p_percentages);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text, 0));
  select * into existing from public.client_operations where op_id = p_operation_id;
  if found then
    if existing.user_id <> actor or existing.op_type <> 'create_budget_draft' or existing.result <> payload then
      raise exception 'operation_conflict' using errcode = '22023';
    end if;
    return existing.entity_id;
  end if;

  insert into public.budgets (id, workspace_id, name, currency, period_start, period_end, income_amount_minor,
    normalized_monthly_income_minor, normalized_annual_income_minor, income_frequency, created_by)
  values (p_operation_id, p_workspace_id, btrim(p_name), p_currency, p_period_start, p_period_end,
    p_income_minor, monthly_minor, annual_minor::bigint, p_income_frequency, actor);
  insert into public.budget_allocations (budget_id, workspace_id, allocation_type, percentage, target_amount_minor, sort_order)
  select p_operation_id, p_workspace_id, bucket, 0, 0, ord - 1
  from unnest(array['ESSENTIALS','INVESTING','EMERGENCY','WANTS']) with ordinality as buckets(bucket, ord);

  revision := public.edit_budget_allocations(p_workspace_id, p_operation_id)->>'revision';
  perform public.edit_budget_allocations(p_workspace_id, p_operation_id, revision, p_percentages, true);
  insert into public.client_operations (op_id, user_id, op_type, entity_id, result)
  values (p_operation_id, actor, 'create_budget_draft', p_operation_id, payload);
  perform public.record_space_audit_event(p_workspace_id, 'budget.created', 'budget', p_operation_id);
  return p_operation_id;
end;
$$;

create function public.activate_budget_draft(p_workspace_id uuid, p_budget_id uuid, p_expected_revision text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  budget public.budgets;
  plan jsonb;
begin
  if auth.uid() is null or not public.has_space_capability(p_workspace_id, 'budget.manage') then
    raise exception 'budget_edit_denied' using errcode = '42501';
  end if;
  select * into budget from public.budgets
    where workspace_id = p_workspace_id and id = p_budget_id for no key update;
  if not found or budget.status not in ('draft','active') then
    raise exception 'budget_not_found' using errcode = 'P0002';
  end if;
  if budget.status = 'active' then return 'active'; end if;

  -- Use the allocation editor's lock order and version. The partial unique
  -- index on active budgets arbitrates two different drafts racing to activate.
  plan := public.edit_budget_allocations(p_workspace_id, p_budget_id);
  if (plan->>'revision') is distinct from p_expected_revision then
    raise exception 'budget_edit_stale' using errcode = '40001';
  end if;
  if (select sum((allocation->>'percentage')::numeric)
      from jsonb_array_elements(plan->'allocations') allocation) is distinct from 100::numeric then
    raise exception 'invalid_budget_total' using errcode = '22023';
  end if;
  update public.budgets set status = 'active'
    where workspace_id = p_workspace_id and id = p_budget_id;
  perform public.record_space_audit_event(p_workspace_id, 'budget.activated', 'budget', p_budget_id);
  return 'active';
end;
$$;

revoke all on function public.create_budget_draft(uuid, uuid, text, text, date, date, bigint, text, jsonb) from public, anon;
revoke all on function public.activate_budget_draft(uuid, uuid, text) from public, anon;
grant execute on function public.create_budget_draft(uuid, uuid, text, text, date, date, bigint, text, jsonb) to authenticated;
grant execute on function public.activate_budget_draft(uuid, uuid, text) to authenticated;
