-- Phase V (PR2): the budget threshold-crossing producer.
--
-- Phase T PR2 shipped record_budget_threshold_crossing(budget, scope,
-- percent) - one alert per strictly-upward bucket crossing, tracked in
-- budget_threshold_state - but nothing has ever called it. This adds
-- sweep_budget_thresholds(workspace): recompute each active budget's
-- total spend against its period income, feed the percentage to
-- record_budget_threshold_crossing, and on a real crossing enqueue a
-- budget.threshold_90 / budget.exceeded notification (Phase V PR1).
--
-- The spend figure here is a deliberately simple total (settled outflows
-- in the budget's currency and period, excluding merged duplicates and
-- confirmed self-transfers) - a "you have spent N% of this budget's
-- money" signal, not the per-allocation breakdown getBudgetActuals()
-- computes for the budgets screen.

create or replace function public.sweep_budget_thresholds(
  p_workspace_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_budget record;
  v_spend_minor bigint;
  v_percent numeric;
  v_bucket text;
  v_event_key text;
  v_alerts integer := 0;
begin
  -- A member (or a service-role / trigger caller) may run the sweep for
  -- their own Space; nobody may poke another Space's budgets.
  if auth.uid() is not null and not public.is_workspace_member(p_workspace_id) then
    raise exception 'You are not a member of this Space.';
  end if;

  select timezone into v_tz from public.workspaces where id = p_workspace_id;
  if not found then
    return 0;
  end if;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;

  for v_budget in
    select b.id, b.currency, b.income_amount_minor, b.period_start, b.period_end
    from public.budgets b
    where b.workspace_id = p_workspace_id
      and b.status = 'active'
      and b.period_start <= v_today
      and b.period_end >= v_today
      and b.income_amount_minor > 0
  loop
    select coalesce(sum(abs(t.principal_effect_rwf + t.fee_effect_rwf)), 0)
      into v_spend_minor
    from public.transactions t
    where t.workspace_id = p_workspace_id
      and t.currency = v_budget.currency
      and t.direction = 'out'
      and t.settlement_state = 'settled'
      and t.dedupe_state <> 'merged'
      and (t.occurred_at at time zone coalesce(v_tz, 'UTC'))::date
            between v_budget.period_start and v_budget.period_end
      and not exists (
        select 1 from public.transfer_links l
        where l.status = 'linked' and l.out_transaction_id = t.id
      );

    v_percent := round(100.0 * v_spend_minor / v_budget.income_amount_minor, 2);
    v_bucket := public.record_budget_threshold_crossing(v_budget.id, '__total__', v_percent);

    if v_bucket is null then
      continue;
    end if;

    v_event_key := case v_bucket
      when 'watch' then 'budget.threshold_75'
      when 'at_risk' then 'budget.threshold_90'
      else 'budget.exceeded'  -- 'exceeded' | 'over'
    end;

    perform public.enqueue_notification(
      p_workspace_id, null, null,
      v_event_key,
      case v_bucket
        when 'watch' then 'A budget has reached 75%'
        when 'at_risk' then 'A budget has reached 90%'
        when 'exceeded' then 'A budget has been exceeded'
        else 'A budget is more than 10% over'
      end,
      null, 'budget', v_budget.id,
      jsonb_build_object('percent', round(v_percent), 'bucket', v_bucket));

    v_alerts := v_alerts + 1;
  end loop;

  return v_alerts;
end;
$$;

comment on function public.sweep_budget_thresholds is
  'Recompute each active budget''s total spend %, feed it to record_budget_threshold_crossing, and enqueue a budget.threshold_90 / budget.exceeded notification on a real upward crossing. Idempotent - safe to call after every ingested transaction. Member-gated per Space.';

revoke all on function public.sweep_budget_thresholds(uuid) from public;
grant execute on function public.sweep_budget_thresholds(uuid) to authenticated, service_role;
