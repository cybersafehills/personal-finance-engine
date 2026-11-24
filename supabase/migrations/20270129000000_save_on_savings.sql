-- Save On: how much the person has saved in transfer fees.
--
-- A "fee_saving" plan (an amount sent in parts because the parts cost less than one
-- transfer) records the fee as one transfer (`single_fee_minor`) and the fee as parts
-- (`planned_fee_minor`), both from a VERIFIED provider tariff. The saving is the
-- difference, and it only counts once EVERY part of the plan has been settled
-- (successful: provider-verified or confirmed by the person). A plan still being sent
-- is reported separately as "expected", and a stopped plan counts for nothing: nothing
-- is claimed that was not actually done. Capacity plans (an amount above the eKash
-- limit) save no fee, so they never appear here.
--
-- Figures are estimates from the provider's published fee table: the provider shows the
-- final fee. Everything is computed live from the plans and their payments, so the
-- numbers are always current; nothing is stored or copied, and nothing here moves money.
--
-- Data only in the sense of no new table: one security-invoker view and one function.
-- Both run under the caller's own RLS, so a person only ever sees their own Spaces.

create view public.save_on_plan_outcomes_v
with (security_invoker = true)
as
select
  p.id as plan_id,
  p.workspace_id,
  p.currency,
  p.total_amount_minor,
  p.single_fee_minor,
  p.planned_fee_minor,
  greatest(p.single_fee_minor - p.planned_fee_minor, 0) as saving_minor,
  jsonb_array_length(p.planned_parts) as parts_planned,
  coalesce(s.settled, 0) as parts_settled,
  case
    when coalesce(s.settled, 0) = jsonb_array_length(p.planned_parts) then 'completed'
    when p.stopped_at is not null then 'stopped'
    else 'in_progress'
  end as status,
  case
    when coalesce(s.settled, 0) = jsonb_array_length(p.planned_parts) then s.last_settled_at
  end as completed_at,
  p.created_at
from public.payment_split_plans p
left join lateral (
  select
    count(*) filter (where i.state = 'successful') as settled,
    max(coalesce(i.verified_at, i.manually_confirmed_at, i.updated_at))
      filter (where i.state = 'successful') as last_settled_at
  from public.payment_intents i
  where i.split_plan_id = p.id
) s on true
where p.kind = 'fee_saving'
  and p.fee_basis = 'verified_tariff'
  and p.single_fee_minor is not null
  and p.planned_fee_minor is not null;

comment on view public.save_on_plan_outcomes_v is
  'One row per Save On fee-saving plan with its saving and whether it is completed (every part settled), in progress or stopped. security_invoker: the caller''s RLS applies.';

grant select on public.save_on_plan_outcomes_v to authenticated;
grant select on public.save_on_plan_outcomes_v to service_role;

-- The report the app shows: the same totals over fixed windows (24 hours, 7 days, 2 weeks,
-- 30 days, 3 months, 12 months, all time), plus what is still being sent and the latest
-- completed plans. A window is by the time the LAST part settled.
create function public.save_on_report(p_workspace uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with o as (
    select * from public.save_on_plan_outcomes_v where workspace_id = p_workspace
  ),
  windows(ord, key, since) as (
    values
      (1, '24h',  now() - interval '24 hours'),
      (2, '7d',   now() - interval '7 days'),
      (3, '14d',  now() - interval '14 days'),
      (4, '30d',  now() - interval '30 days'),
      (5, '90d',  now() - interval '90 days'),
      (6, '365d', now() - interval '365 days'),
      (7, 'all',  null::timestamptz)
  )
  select jsonb_build_object(
    'generated_at', now(),
    'currency', 'RWF',
    'periods', (
      select jsonb_agg(
        jsonb_build_object(
          'key', w.key,
          'saved_minor', a.saved,
          'would_have_paid_minor', a.would,
          'paid_minor', a.paid,
          'plans', a.plans,
          'transfers', a.transfers
        ) order by w.ord
      )
      from windows w
      cross join lateral (
        select
          coalesce(sum(o.saving_minor), 0)::bigint as saved,
          coalesce(sum(o.single_fee_minor), 0)::bigint as would,
          coalesce(sum(o.planned_fee_minor), 0)::bigint as paid,
          count(*)::int as plans,
          coalesce(sum(o.parts_planned), 0)::int as transfers
        from o
        where o.status = 'completed' and (w.since is null or o.completed_at >= w.since)
      ) a
    ),
    'in_progress', (
      select jsonb_build_object(
        'plans', count(*)::int,
        'expected_saving_minor', coalesce(sum(o.saving_minor), 0)::bigint
      )
      from o where o.status = 'in_progress'
    ),
    'recent', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'plan_id', r.plan_id,
          'completed_at', r.completed_at,
          'total_minor', r.total_amount_minor,
          'saved_minor', r.saving_minor,
          'transfers', r.parts_planned
        ) order by r.completed_at desc
      )
      from (
        select * from o where status = 'completed' order by completed_at desc limit 5
      ) r
    ), '[]'::jsonb)
  );
$$;

comment on function public.save_on_report(uuid) is
  'Save On savings for one Space over fixed windows, from verified-tariff fee-saving plans whose every part is settled. Estimates; the provider shows the final fee. Runs under the caller''s RLS.';

grant execute on function public.save_on_report(uuid) to authenticated;
