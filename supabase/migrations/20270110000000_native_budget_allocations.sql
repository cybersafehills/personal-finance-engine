-- Read, preview, and atomically replace an existing budget's four allocations.
-- The revision covers income, status, currency, and every allocation row.
create function public.edit_budget_allocations(
  p_workspace_id uuid,
  p_budget_id uuid,
  p_expected_revision text default null,
  p_percentages jsonb default null,
  p_save boolean default false
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  budget public.budgets;
  current_allocations jsonb;
  revision text;
  targets jsonb;
  total numeric;
  allocation_count integer;
  result jsonb;
begin
  if auth.uid() is null or not public.has_space_capability(p_workspace_id, 'budget.manage') then
    raise exception 'budget_edit_denied' using errcode = '42501';
  end if;

  select * into budget from public.budgets
    where id = p_budget_id and workspace_id = p_workspace_id for no key update;
  if not found or budget.status not in ('active', 'draft') then
    raise exception 'budget_not_found' using errcode = 'P0002';
  end if;

  select count(*), jsonb_agg(jsonb_build_object(
      'id', a.id, 'type', a.allocation_type, 'percentage', a.percentage,
      'target_minor', a.target_amount_minor::text, 'updated', extract(epoch from a.updated_at)
    ) order by a.allocation_type)
    into allocation_count, current_allocations
    from (
      select * from public.budget_allocations
      where budget_id = p_budget_id and workspace_id = p_workspace_id
      order by allocation_type for update
    ) a;
  if allocation_count <> 4 then
    raise exception 'budget_allocations_missing' using errcode = 'P0002';
  end if;

  revision := md5(jsonb_build_array(budget.id, budget.status, budget.currency,
    budget.normalized_monthly_income_minor, current_allocations)::text);
  result := jsonb_build_object('revision', revision, 'currency', budget.currency,
    'status', budget.status, 'allocations', current_allocations);

  if p_save is null then
    raise exception 'invalid_budget_edit_mode' using errcode = '22023';
  end if;
  if p_percentages is null and not p_save then
    return result;
  end if;
  if p_expected_revision is distinct from revision then
    raise exception 'budget_edit_stale' using errcode = '40001';
  end if;
  if jsonb_typeof(p_percentages) is distinct from 'object'
      or not (p_percentages ?& array['ESSENTIALS','INVESTING','EMERGENCY','WANTS']) then
    raise exception 'invalid_budget_percentages' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_each(p_percentages)) <> 4
      or exists (select 1 from jsonb_each(p_percentages) as item
        where jsonb_typeof(item.value) <> 'number') then
    raise exception 'invalid_budget_percentages' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each_text(p_percentages) as item
      where item.value::numeric not between 0 and 100
        or item.value::numeric <> trunc(item.value::numeric, 2)) then
    raise exception 'invalid_budget_percentages' using errcode = '22023';
  end if;
  select sum(value::numeric) into total from jsonb_each_text(p_percentages);
  if total > 100 or (budget.status = 'active' and total <> 100) then
    raise exception 'invalid_budget_total' using errcode = '22023';
  end if;

  -- Match allocateAmounts() in web/lib/budget-math.ts. Largest fractional
  -- remainder wins, ties use the established allocation order. Drafts below
  -- 100% leave the unallocated amount untouched.
  with products as (
    select item.key, item.value::numeric as percentage, ord,
      budget.normalized_monthly_income_minor::numeric * item.value::numeric * 0.01 as exact_minor
    from jsonb_each_text(p_percentages) item
    join unnest(array['ESSENTIALS','INVESTING','EMERGENCY','WANTS'])
      with ordinality as types(name, ord) on types.name = item.key
  ), ranked as (
    select *, floor(exact_minor) as base_minor,
      row_number() over (order by exact_minor - floor(exact_minor) desc, ord) as rank,
      sum(floor(exact_minor)) over () as base_sum
    from products
  )
  select jsonb_agg(jsonb_build_object('type', key, 'percentage', percentage,
    'target_minor', (base_minor + case
      when total = 100 and rank <= budget.normalized_monthly_income_minor - base_sum then 1
      else 0 end)::bigint::text) order by ord) into targets
  from ranked;

  if not p_save then
    return result || jsonb_build_object('allocations', targets);
  end if;

  update public.budget_allocations a set
    percentage = target.percentage, target_amount_minor = target.target_minor
  from jsonb_to_recordset(targets) as target(type text, percentage numeric, target_minor bigint)
  where a.budget_id = p_budget_id and a.workspace_id = p_workspace_id and a.allocation_type = target.type;

  perform public.record_space_audit_event(p_workspace_id, 'budget.allocations_updated',
    'budget', p_budget_id, current_allocations, targets);
  return jsonb_build_object('saved', true);
end;
$$;

revoke all on function public.edit_budget_allocations(uuid, uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.edit_budget_allocations(uuid, uuid, text, jsonb, boolean) to authenticated;
