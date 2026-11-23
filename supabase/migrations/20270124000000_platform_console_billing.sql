-- Platform Console: subscription billing ledger (see
-- docs/platform-console/billing-design.md for the decisions D1-D9).
--
-- This is a STAFF-RUN LEDGER. No payment provider is integrated and nothing
-- here moves money. It never touches workspace_plans (entitlements): billing
-- records what a workspace paid for, not what it can use (decision D2).
--
-- Rules enforced here, not in the app:
--   * plan prices are fixed by a check constraint: yearly = monthly x 12
--     (no annual discount)
--   * a payment can only be recorded at the plan's exact price (the amount is
--     derived from the plan, never supplied), and is idempotent on
--     (provider, provider_reference)
--   * payment status and reconciliation state are separate; only 'succeeded'
--     counts as cash
--   * refunds: requested -> approved/rejected by a DIFFERENT person who holds
--     approve_refunds -> processed with an external payout reference; total
--     refunds per payment can never exceed the payment; one open refund per
--     payment
--   * every command is one SECURITY DEFINER function, locks the row it changes,
--     and writes its audit row in the same transaction
--   * no table has any grant to anon/authenticated; ledgers are insert-only
--     where they record history

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.billing_plans (
  code text primary key check (code in ('personal', 'vip', 'business')),
  name text not null,
  monthly_rwf integer not null check (monthly_rwf > 0),
  yearly_rwf integer not null check (yearly_rwf > 0),
  -- Proposed mapping to workspace_plans tiers. UNUSED until a product
  -- decision approves it (D2); nothing reads this to grant entitlements.
  entitlement_tier text check (entitlement_tier in ('free', 'personal_plus', 'household', 'business')),
  active boolean not null default true,
  constraint billing_plans_no_annual_discount check (yearly_rwf = monthly_rwf * 12)
);
comment on table public.billing_plans is
  'Official commercial plans. Prices in RWF. yearly = monthly x 12 is enforced (no annual discount).';

insert into public.billing_plans (code, name, monthly_rwf, yearly_rwf, entitlement_tier) values
  ('personal', 'Personal', 2500, 30000, 'personal_plus'),
  ('vip', 'VIP', 5000, 60000, 'household'),
  ('business', 'Business', 10000, 120000, 'business');

-- ---------------------------------------------------------------------------
-- Subscriptions, payments, refunds, history
-- ---------------------------------------------------------------------------
create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  sub_no bigint generated always as identity,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  plan_code text not null references public.billing_plans (code),
  billing_interval text not null check (billing_interval in ('monthly', 'yearly')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'past_due', 'cancelled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one live subscription per workspace
create unique index uq_billing_sub_live
  on public.billing_subscriptions (workspace_id) where status in ('pending', 'active', 'past_due');
create index idx_billing_sub_status on public.billing_subscriptions (status, updated_at desc);

create table public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  payment_no bigint generated always as identity,
  subscription_id uuid not null references public.billing_subscriptions (id) on delete restrict,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  amount_rwf integer not null check (amount_rwf > 0),
  provider text not null check (provider in ('mtn_momo', 'airtel_money', 'bank', 'card', 'manual')),
  provider_reference text not null check (char_length(provider_reference) between 3 and 100),
  status text not null check (status in ('initiated', 'succeeded', 'failed', 'reversed')),
  source text not null default 'staff_recorded' check (source in ('staff_recorded', 'provider_webhook')),
  reconciliation_state text not null default 'unreconciled'
    check (reconciliation_state in ('unreconciled', 'matched', 'exception')),
  reconciliation_note text check (reconciliation_note is null or char_length(reconciliation_note) <= 500),
  initiated_at timestamptz not null default now(),
  settled_at timestamptz,
  recorded_by uuid,
  constraint billing_payments_provider_ref_unique unique (provider, provider_reference),
  constraint billing_payments_settled check ((status = 'succeeded') = (settled_at is not null) or status in ('reversed'))
);
create index idx_billing_payments_status on public.billing_payments (status, initiated_at desc);
create index idx_billing_payments_sub on public.billing_payments (subscription_id, initiated_at desc);

create table public.billing_refunds (
  id uuid primary key default gen_random_uuid(),
  refund_no bigint generated always as identity,
  payment_id uuid not null references public.billing_payments (id) on delete restrict,
  amount_rwf integer not null check (amount_rwf > 0),
  reason text not null check (char_length(reason) between 10 and 500),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'processed')),
  requested_by uuid not null,
  decided_by uuid,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  payout_reference text check (payout_reference is null or char_length(payout_reference) between 3 and 100),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  processed_by uuid,
  processed_at timestamptz,
  constraint billing_refund_processed_ref check (status <> 'processed' or payout_reference is not null)
);
-- at most one OPEN refund per payment (idempotency against double submit)
create unique index uq_billing_refund_open
  on public.billing_refunds (payment_id) where status in ('requested', 'approved');

create table public.billing_subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.billing_subscriptions (id) on delete cascade,
  kind text not null check (kind in ('created', 'payment', 'period_extended', 'cancel_scheduled', 'cancelled', 'past_due', 'expired')),
  from_status text,
  to_status text,
  actor_user_id uuid,
  actor_role text,
  created_at timestamptz not null default now()
);
create index idx_billing_sub_events on public.billing_subscription_events (subscription_id, created_at);

alter table public.billing_plans enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_refunds enable row level security;
alter table public.billing_subscription_events enable row level security;

revoke all on public.billing_plans from anon, authenticated;
revoke all on public.billing_subscriptions from anon, authenticated;
revoke all on public.billing_payments from anon, authenticated;
revoke all on public.billing_refunds from anon, authenticated;
revoke all on public.billing_subscription_events from anon, authenticated;

revoke all on public.billing_plans from service_role;
revoke all on public.billing_subscriptions from service_role;
revoke all on public.billing_payments from service_role;
revoke all on public.billing_refunds from service_role;
revoke all on public.billing_subscription_events from service_role;
grant select on public.billing_plans to service_role;
grant select, insert, update on public.billing_subscriptions to service_role;
grant select, insert, update on public.billing_payments to service_role;
grant select, insert, update on public.billing_refunds to service_role;
grant select, insert on public.billing_subscription_events to service_role;

create trigger billing_events_append_only
  before update or delete on public.billing_subscription_events
  for each row execute function public.console_append_only();
create trigger billing_events_no_truncate
  before truncate on public.billing_subscription_events
  for each statement execute function public.console_append_only();

-- Prices are catalog data: never editable at runtime, even by service_role.
create trigger billing_plans_immutable
  before update or delete on public.billing_plans
  for each row execute function public.console_append_only();

-- ---------------------------------------------------------------------------
-- Reads (permission: view_financial_metrics)
-- ---------------------------------------------------------------------------
create function public.console_billing_overview(p_days integer default 30)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_start timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_prev timestamptz := now() - make_interval(days => 2 * greatest(1, least(coalesce(p_days, 30), 365)));
  v_collected bigint;
  v_collected_prev bigint;
  v_mrr numeric;
begin
  perform public.console_assert('view_financial_metrics');

  select coalesce(sum(amount_rwf), 0) into v_collected from public.billing_payments
   where status = 'succeeded' and settled_at >= v_start;
  v_collected := v_collected - coalesce((select sum(amount_rwf) from public.billing_refunds
                                          where status = 'processed' and processed_at >= v_start), 0);
  select coalesce(sum(amount_rwf), 0) into v_collected_prev from public.billing_payments
   where status = 'succeeded' and settled_at >= v_prev and settled_at < v_start;
  v_collected_prev := v_collected_prev - coalesce((select sum(amount_rwf) from public.billing_refunds
                                          where status = 'processed' and processed_at >= v_prev and processed_at < v_start), 0);

  select coalesce(round(sum(case s.billing_interval when 'monthly' then p.monthly_rwf else p.yearly_rwf / 12.0 end)), 0)
    into v_mrr
    from public.billing_subscriptions s join public.billing_plans p on p.code = s.plan_code
   where s.status = 'active';

  return jsonb_build_object(
    'window_days', v_days,
    'generated_at', now(),
    'has_any_data', exists (select 1 from public.billing_subscriptions),
    'plans', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'monthly_rwf', monthly_rwf, 'yearly_rwf', yearly_rwf) order by monthly_rwf) from public.billing_plans),
    'subscriptions_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.billing_subscriptions group by status) c), '{}'::jsonb),
    'active_by_plan', coalesce((select jsonb_agg(jsonb_build_object('plan', plan_code, 'interval', billing_interval, 'count', n))
                                  from (select plan_code, billing_interval, count(*) as n from public.billing_subscriptions where status = 'active' group by 1, 2) c), '[]'::jsonb),
    'mrr_rwf', v_mrr,
    'arr_rwf', v_mrr * 12,
    'collected_rwf', v_collected,
    'collected_prev_rwf', v_collected_prev,
    'payments', jsonb_build_object(
      'initiated', (select count(*) from public.billing_payments where initiated_at >= v_start),
      'succeeded', (select count(*) from public.billing_payments where initiated_at >= v_start and status = 'succeeded'),
      'failed', (select count(*) from public.billing_payments where initiated_at >= v_start and status = 'failed'),
      'pending', (select count(*) from public.billing_payments where status = 'initiated')),
    'reconciliation', jsonb_build_object(
      'unreconciled', (select count(*) from public.billing_payments where status = 'succeeded' and reconciliation_state = 'unreconciled'),
      'exceptions', (select count(*) from public.billing_payments where reconciliation_state = 'exception')),
    'refunds', jsonb_build_object(
      'pending', (select count(*) from public.billing_refunds where status in ('requested', 'approved')),
      'pending_rwf', coalesce((select sum(amount_rwf) from public.billing_refunds where status in ('requested', 'approved')), 0),
      'processed_rwf', coalesce((select sum(amount_rwf) from public.billing_refunds where status = 'processed' and processed_at >= v_start), 0)),
    'collections_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'rwf', coalesce(c.rwf, 0)) order by d.day)
      from (select gs::date as day from generate_series((v_start at time zone 'Africa/Kigali')::date, (now() at time zone 'Africa/Kigali')::date, interval '1 day') gs) d
      left join (select (settled_at at time zone 'Africa/Kigali')::date as day, sum(amount_rwf) as rwf
                   from public.billing_payments where status = 'succeeded' and settled_at >= v_start group by 1) c on c.day = d.day
    ), '[]'::jsonb),
    'churn', jsonb_build_object(
      'active_at_start', (select count(*) from public.billing_subscriptions s
                           where s.created_at < v_start and (s.cancelled_at is null or s.cancelled_at >= v_start)
                             and s.status <> 'pending'),
      'ended_in_range', (select count(*) from public.billing_subscription_events e
                          where e.kind in ('cancelled', 'expired') and e.created_at >= v_start))
  );
end;
$$;

create function public.console_billing_subscriptions(
  p_status text default null, p_limit integer default 25, p_before timestamptz default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  perform public.console_assert('view_financial_metrics');
  if p_status is not null and p_status not in ('pending','active','past_due','cancelled','expired','live') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(r) order by r.updated_at desc)
    from (
      select s.id, 'SUB-' || lpad(s.sub_no::text, 4, '0') as ref, left(s.workspace_id::text, 8) as workspace_ref,
             w.kind as workspace_kind, s.plan_code, s.billing_interval, s.status,
             s.current_period_start, s.current_period_end, s.cancel_at_period_end, s.created_at, s.updated_at,
             (select pp.status from public.billing_payments pp where pp.subscription_id = s.id order by pp.initiated_at desc limit 1) as last_payment_status
        from public.billing_subscriptions s join public.workspaces w on w.id = s.workspace_id
       where (p_status is null or (p_status = 'live' and s.status in ('pending','active','past_due')) or s.status = p_status)
         and (p_before is null or s.updated_at < p_before)
       order by s.updated_at desc limit v_limit
    ) r), '[]'::jsonb);
end;
$$;

create function public.console_billing_subscription_get(p_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v jsonb;
begin
  perform public.console_assert('view_financial_metrics');
  select jsonb_build_object(
    'id', s.id, 'ref', 'SUB-' || lpad(s.sub_no::text, 4, '0'),
    'workspace_ref', left(s.workspace_id::text, 8), 'workspace_kind', w.kind,
    'plan_code', s.plan_code, 'plan_name', p.name, 'billing_interval', s.billing_interval,
    'price_rwf', case s.billing_interval when 'monthly' then p.monthly_rwf else p.yearly_rwf end,
    'status', s.status, 'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
    'cancel_at_period_end', s.cancel_at_period_end, 'cancelled_at', s.cancelled_at, 'cancel_reason', s.cancel_reason,
    'created_at', s.created_at,
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pp.id, 'ref', 'PAY-' || lpad(pp.payment_no::text, 5, '0'), 'amount_rwf', pp.amount_rwf,
        'provider', pp.provider, 'provider_reference', pp.provider_reference, 'status', pp.status,
        'reconciliation_state', pp.reconciliation_state, 'initiated_at', pp.initiated_at, 'settled_at', pp.settled_at) order by pp.initiated_at desc)
        from public.billing_payments pp where pp.subscription_id = s.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'from_status', e.from_status, 'to_status', e.to_status,
        'actor_role', e.actor_role, 'created_at', e.created_at) order by e.created_at, e.id)
        from public.billing_subscription_events e where e.subscription_id = s.id), '[]'::jsonb)
  ) into v
  from public.billing_subscriptions s join public.billing_plans p on p.code = s.plan_code
  join public.workspaces w on w.id = s.workspace_id where s.id = p_id;
  if v is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  return v;
end;
$$;

create function public.console_billing_payments(
  p_status text default null, p_recon text default null, p_limit integer default 25, p_before timestamptz default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  perform public.console_assert('view_financial_metrics');
  if p_status is not null and p_status not in ('initiated','succeeded','failed','reversed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_recon is not null and p_recon not in ('unreconciled','matched','exception') then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(r) order by r.initiated_at desc)
    from (
      select pp.id, 'PAY-' || lpad(pp.payment_no::text, 5, '0') as ref, 'SUB-' || lpad(s.sub_no::text, 4, '0') as subscription_ref,
             s.id as subscription_id, left(pp.workspace_id::text, 8) as workspace_ref, s.plan_code,
             pp.amount_rwf, pp.provider, pp.provider_reference, pp.status, pp.source, pp.reconciliation_state,
             pp.reconciliation_note, pp.initiated_at, pp.settled_at,
             coalesce((select sum(f.amount_rwf) from public.billing_refunds f where f.payment_id = pp.id and f.status = 'processed'), 0) as refunded_rwf
        from public.billing_payments pp join public.billing_subscriptions s on s.id = pp.subscription_id
       where (p_status is null or pp.status = p_status) and (p_recon is null or pp.reconciliation_state = p_recon)
         and (p_before is null or pp.initiated_at < p_before)
       order by pp.initiated_at desc limit v_limit
    ) r), '[]'::jsonb);
end;
$$;

create function public.console_billing_analytics(p_months integer default 12)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_months integer := greatest(3, least(coalesce(p_months, 12), 36));
  v_from date := (date_trunc('month', now() at time zone 'Africa/Kigali') - make_interval(months => greatest(3, least(coalesce(p_months, 12), 36)) - 1))::date;
begin
  perform public.console_assert('view_financial_metrics');
  return jsonb_build_object(
    'generated_at', now(),
    'has_any_data', exists (select 1 from public.billing_payments),
    'collected_by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'),
              'collected', coalesce(c.paid, 0) - coalesce(r.refunded, 0)) order by m.month)
      from generate_series(v_from, (now() at time zone 'Africa/Kigali')::date, interval '1 month') as m(month)
      left join (select date_trunc('month', settled_at at time zone 'Africa/Kigali')::date as month, sum(amount_rwf) as paid
                   from public.billing_payments where status = 'succeeded' group by 1) c on c.month = m.month::date
      left join (select date_trunc('month', processed_at at time zone 'Africa/Kigali')::date as month, sum(amount_rwf) as refunded
                   from public.billing_refunds where status = 'processed' group by 1) r on r.month = m.month::date
    ), '[]'::jsonb),
    'by_plan', coalesce((select jsonb_agg(jsonb_build_object('plan', plan_code, 'collected', rwf, 'payments', n) order by rwf desc)
        from (select s.plan_code, sum(pp.amount_rwf) as rwf, count(*) as n
                from public.billing_payments pp join public.billing_subscriptions s on s.id = pp.subscription_id
               where pp.status = 'succeeded' group by 1) x), '[]'::jsonb),
    'by_provider', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'succeeded', ok, 'failed', bad) order by provider)
        from (select provider, count(*) filter (where status = 'succeeded') as ok, count(*) filter (where status = 'failed') as bad
                from public.billing_payments group by 1) x), '[]'::jsonb),
    'new_by_month', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'count', n) order by month)
        from (select date_trunc('month', created_at at time zone 'Africa/Kigali')::date as month, count(*) as n
                from public.billing_subscriptions where created_at >= v_from group by 1) x), '[]'::jsonb),
    'ended_by_month', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'count', n) order by month)
        from (select date_trunc('month', created_at at time zone 'Africa/Kigali')::date as month, count(*) as n
                from public.billing_subscription_events where kind in ('cancelled', 'expired') and created_at >= v_from group by 1) x), '[]'::jsonb)
  );
end;
$$;

-- Find a workspace to subscribe. Reference + type only; never names.
create function public.console_billing_workspace_lookup(p_ref text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_ref text := lower(regexp_replace(coalesce(p_ref, ''), '[^0-9a-fA-F]', '', 'g'));
begin
  perform public.console_assert('manage_subscriptions');
  if char_length(v_ref) < 6 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', w.id, 'ref', left(w.id::text, 8), 'kind', w.kind,
             'has_live_subscription', exists (select 1 from public.billing_subscriptions s
               where s.workspace_id = w.id and s.status in ('pending', 'active', 'past_due'))))
      from (select id, kind from public.workspaces where id::text like v_ref || '%' limit 5) w
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Commands (permission: manage_subscriptions unless noted)
-- ---------------------------------------------------------------------------
create function public.console_billing_create_subscription(p_workspace uuid, p_plan text, p_interval text)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_id uuid;
  v_no bigint;
begin
  v_role := public.console_assert('manage_subscriptions');
  if not exists (select 1 from public.workspaces where id = p_workspace) then
    raise exception 'workspace_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.billing_plans where code = p_plan and active) then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;
  insert into public.billing_subscriptions (workspace_id, plan_code, billing_interval, created_by)
    values (p_workspace, p_plan, p_interval, auth.uid()) returning id, sub_no into v_id, v_no;
  insert into public.billing_subscription_events (subscription_id, kind, to_status, actor_user_id, actor_role)
    values (v_id, 'created', 'pending', auth.uid(), v_role);
  perform public.console_audit_internal(v_role, 'billing.subscription_created', 'subscription',
    'SUB-' || lpad(v_no::text, 4, '0'), 'success', jsonb_build_object('plan', p_plan, 'interval', p_interval));
  return v_id;
exception when unique_violation then
  raise exception 'already_subscribed' using errcode = '22023';
end;
$$;

-- Records a payment at the plan's exact price. Idempotent on
-- (provider, reference). A 'succeeded' outcome settles it and extends the
-- subscription period.
create function public.console_billing_record_payment(
  p_subscription uuid, p_provider text, p_reference text, p_outcome text default 'succeeded'
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_sub public.billing_subscriptions%rowtype;
  v_price integer;
  v_existing public.billing_payments%rowtype;
  v_pay uuid;
  v_pno bigint;
  v_base timestamptz;
  v_end timestamptz;
  v_ref text := btrim(coalesce(p_reference, ''));
begin
  v_role := public.console_assert('manage_subscriptions');
  if p_outcome not in ('initiated', 'succeeded', 'failed') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  if char_length(v_ref) < 3 then raise exception 'reference_required' using errcode = '22023'; end if;

  select * into v_sub from public.billing_subscriptions where id = p_subscription for update;
  if v_sub.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  -- Idempotency: the same provider reference is never counted twice.
  select * into v_existing from public.billing_payments where provider = p_provider and provider_reference = v_ref;
  if v_existing.id is not null then
    if v_existing.subscription_id <> v_sub.id then
      raise exception 'reference_in_use' using errcode = '22023';
    end if;
    return jsonb_build_object('payment_id', v_existing.id, 'status', v_existing.status, 'duplicate', true);
  end if;

  if v_sub.status in ('cancelled', 'expired') then
    raise exception 'subscription_closed' using errcode = '22023';
  end if;

  select case v_sub.billing_interval when 'monthly' then monthly_rwf else yearly_rwf end
    into v_price from public.billing_plans where code = v_sub.plan_code;

  insert into public.billing_payments
    (subscription_id, workspace_id, amount_rwf, provider, provider_reference, status, recorded_by, settled_at)
  values (v_sub.id, v_sub.workspace_id, v_price, p_provider, v_ref, p_outcome, auth.uid(),
          case when p_outcome = 'succeeded' then now() end)
  returning id, payment_no into v_pay, v_pno;

  insert into public.billing_subscription_events (subscription_id, kind, actor_user_id, actor_role)
    values (v_sub.id, 'payment', auth.uid(), v_role);

  if p_outcome = 'succeeded' then
    v_base := case when v_sub.status = 'active' then greatest(now(), coalesce(v_sub.current_period_end, now())) else now() end;
    v_end := case v_sub.billing_interval when 'monthly' then v_base + interval '1 month' else v_base + interval '1 year' end;
    update public.billing_subscriptions
       set status = 'active',
           current_period_start = case when v_sub.status = 'active' then v_sub.current_period_start else now() end,
           current_period_end = v_end, updated_at = now()
     where id = v_sub.id;
    insert into public.billing_subscription_events (subscription_id, kind, from_status, to_status, actor_user_id, actor_role)
      values (v_sub.id, 'period_extended', v_sub.status, 'active', auth.uid(), v_role);
  end if;

  perform public.console_audit_internal(v_role, 'billing.payment_recorded', 'payment',
    'PAY-' || lpad(v_pno::text, 5, '0'), 'success',
    jsonb_build_object('provider', p_provider, 'outcome', p_outcome, 'amount_rwf', v_price));
  return jsonb_build_object('payment_id', v_pay, 'status', p_outcome, 'duplicate', false);
end;
$$;

-- Settle a payment that was recorded as 'initiated'.
create function public.console_billing_settle_payment(p_payment uuid, p_outcome text)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_pay public.billing_payments%rowtype;
  v_sub public.billing_subscriptions%rowtype;
  v_base timestamptz;
  v_end timestamptz;
begin
  v_role := public.console_assert('manage_subscriptions');
  if p_outcome not in ('succeeded', 'failed') then raise exception 'invalid_outcome' using errcode = '22023'; end if;
  select * into v_pay from public.billing_payments where id = p_payment for update;
  if v_pay.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_pay.status <> 'initiated' then raise exception 'not_initiated' using errcode = '22023'; end if;
  select * into v_sub from public.billing_subscriptions where id = v_pay.subscription_id for update;
  if p_outcome = 'succeeded' and v_sub.status in ('cancelled', 'expired') then
    raise exception 'subscription_closed' using errcode = '22023';
  end if;

  update public.billing_payments set status = p_outcome, settled_at = case when p_outcome = 'succeeded' then now() end where id = v_pay.id;
  if p_outcome = 'succeeded' then
    v_base := case when v_sub.status = 'active' then greatest(now(), coalesce(v_sub.current_period_end, now())) else now() end;
    v_end := case v_sub.billing_interval when 'monthly' then v_base + interval '1 month' else v_base + interval '1 year' end;
    update public.billing_subscriptions
       set status = 'active',
           current_period_start = case when v_sub.status = 'active' then v_sub.current_period_start else now() end,
           current_period_end = v_end, updated_at = now()
     where id = v_sub.id;
    insert into public.billing_subscription_events (subscription_id, kind, from_status, to_status, actor_user_id, actor_role)
      values (v_sub.id, 'period_extended', v_sub.status, 'active', auth.uid(), v_role);
  end if;
  perform public.console_audit_internal(v_role, 'billing.payment_settled', 'payment',
    'PAY-' || lpad(v_pay.payment_no::text, 5, '0'), 'success', jsonb_build_object('outcome', p_outcome));
  return p_outcome;
end;
$$;

create function public.console_billing_set_reconciliation(p_payment uuid, p_state text, p_note text default null)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_no bigint;
begin
  v_role := public.console_assert('manage_subscriptions');
  if p_state not in ('unreconciled', 'matched', 'exception') then raise exception 'invalid_state' using errcode = '22023'; end if;
  if p_state = 'exception' and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'note_required' using errcode = '22023';
  end if;
  select payment_no into v_no from public.billing_payments where id = p_payment for update;
  if v_no is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.billing_payments set reconciliation_state = p_state, reconciliation_note = nullif(btrim(p_note), '') where id = p_payment;
  perform public.console_audit_internal(v_role, 'billing.reconciliation_set', 'payment',
    'PAY-' || lpad(v_no::text, 5, '0'), 'success', jsonb_build_object('state', p_state));
end;
$$;

create function public.console_billing_cancel(p_subscription uuid, p_at_period_end boolean, p_reason text)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_sub public.billing_subscriptions%rowtype;
begin
  v_role := public.console_assert('manage_subscriptions');
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into v_sub from public.billing_subscriptions where id = p_subscription for update;
  if v_sub.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_sub.status in ('cancelled', 'expired') then return v_sub.status; end if;  -- idempotent

  if p_at_period_end and v_sub.status = 'active' then
    if v_sub.cancel_at_period_end then return 'active'; end if;
    update public.billing_subscriptions set cancel_at_period_end = true, cancel_reason = btrim(p_reason), updated_at = now() where id = v_sub.id;
    insert into public.billing_subscription_events (subscription_id, kind, from_status, to_status, actor_user_id, actor_role)
      values (v_sub.id, 'cancel_scheduled', 'active', 'active', auth.uid(), v_role);
    perform public.console_audit_internal(v_role, 'billing.cancel_scheduled', 'subscription', 'SUB-' || lpad(v_sub.sub_no::text, 4, '0'));
    return 'active';
  end if;

  update public.billing_subscriptions set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now() where id = v_sub.id;
  insert into public.billing_subscription_events (subscription_id, kind, from_status, to_status, actor_user_id, actor_role)
    values (v_sub.id, 'cancelled', v_sub.status, 'cancelled', auth.uid(), v_role);
  perform public.console_audit_internal(v_role, 'billing.cancelled', 'subscription', 'SUB-' || lpad(v_sub.sub_no::text, 4, '0'));
  return 'cancelled';
end;
$$;

-- Apply period ends. Idempotent: running it twice changes nothing the second time.
create function public.console_billing_roll_periods()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  r record;
  v_cancelled integer := 0;
  v_past_due integer := 0;
  v_expired integer := 0;
begin
  v_role := public.console_assert('manage_subscriptions');
  for r in select id, cancel_at_period_end from public.billing_subscriptions
            where status = 'active' and current_period_end < now() for update loop
    if r.cancel_at_period_end then
      update public.billing_subscriptions set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = r.id;
      insert into public.billing_subscription_events (subscription_id, kind, from_status, to_status, actor_user_id, actor_role)
        values (r.id, 'cancelled', 'active', 'cancelled', auth.uid(), v_role);
      v_cancelled := v_cancelled + 1;
    else
      update public.billing_subscriptions set status = 'past_due', updated_at = now() where id = r.id;
      insert into public.billing_subscription_events (subscription_id, kind, from_status, to_status, actor_user_id, actor_role)
        values (r.id, 'past_due', 'active', 'past_due', auth.uid(), v_role);
      v_past_due := v_past_due + 1;
    end if;
  end loop;
  for r in select id from public.billing_subscriptions
            where status = 'past_due' and current_period_end < now() - interval '7 days' for update loop
    update public.billing_subscriptions set status = 'expired', updated_at = now() where id = r.id;
    insert into public.billing_subscription_events (subscription_id, kind, from_status, to_status, actor_user_id, actor_role)
      values (r.id, 'expired', 'past_due', 'expired', auth.uid(), v_role);
    v_expired := v_expired + 1;
  end loop;
  perform public.console_audit_internal(v_role, 'billing.periods_rolled', 'billing', 'periods', 'success',
    jsonb_build_object('cancelled', v_cancelled, 'past_due', v_past_due, 'expired', v_expired));
  return jsonb_build_object('cancelled', v_cancelled, 'past_due', v_past_due, 'expired', v_expired);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds (four-eyes; the console never pays anyone)
-- ---------------------------------------------------------------------------
create function public.console_billing_refunds(p_status text default null, p_limit integer default 50)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_role text;
begin
  v_role := public.console_assert('view_financial_metrics');
  if p_status is not null and p_status not in ('requested','approved','rejected','processed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'viewer_id', auth.uid(),
    'viewer_can_decide', exists (select 1 from public.console_role_permissions rp where rp.role = v_role and rp.permission = 'approve_refunds'),
    'viewer_can_request', exists (select 1 from public.console_role_permissions rp where rp.role = v_role and rp.permission = 'manage_subscriptions'),
    'rows', coalesce((
      select jsonb_agg(row_to_json(r) order by r.created_at desc)
      from (
        select f.id, 'REF-' || lpad(f.refund_no::text, 4, '0') as ref, 'PAY-' || lpad(pp.payment_no::text, 5, '0') as payment_ref,
               pp.amount_rwf as payment_rwf, f.amount_rwf, f.reason, f.status, f.requested_by,
               (select u.email from auth.users u where u.id = f.requested_by) as requested_by_email,
               (select u.email from auth.users u where u.id = f.decided_by) as decided_by_email,
               f.decision_note, f.payout_reference, f.created_at, f.decided_at, f.processed_at
          from public.billing_refunds f join public.billing_payments pp on pp.id = f.payment_id
         where p_status is null or f.status = p_status
         order by f.created_at desc limit v_limit
      ) r), '[]'::jsonb));
end;
$$;

create function public.console_billing_refund_request(p_payment uuid, p_amount integer, p_reason text)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_pay public.billing_payments%rowtype;
  v_committed integer;
  v_id uuid;
  v_no bigint;
begin
  v_role := public.console_assert('manage_subscriptions');
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into v_pay from public.billing_payments where id = p_payment for update;
  if v_pay.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_pay.status <> 'succeeded' then raise exception 'payment_not_settled' using errcode = '22023'; end if;
  select coalesce(sum(amount_rwf), 0) into v_committed from public.billing_refunds
   where payment_id = v_pay.id and status in ('requested', 'approved', 'processed');
  if p_amount is null or p_amount <= 0 or p_amount > v_pay.amount_rwf - v_committed then
    raise exception 'refund_exceeds_payment' using errcode = '22023';
  end if;
  insert into public.billing_refunds (payment_id, amount_rwf, reason, requested_by)
    values (v_pay.id, p_amount, btrim(p_reason), auth.uid()) returning id, refund_no into v_id, v_no;
  perform public.console_audit_internal(v_role, 'billing.refund_requested', 'refund', 'REF-' || lpad(v_no::text, 4, '0'),
    'success', jsonb_build_object('amount_rwf', p_amount));
  return v_id;
exception when unique_violation then
  raise exception 'refund_already_open' using errcode = '22023';
end;
$$;

create function public.console_billing_refund_decide(p_refund uuid, p_decision text, p_note text default null)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_ref public.billing_refunds%rowtype;
begin
  v_role := public.console_assert('approve_refunds');
  if p_decision not in ('approve', 'reject') then raise exception 'invalid_decision' using errcode = '22023'; end if;
  select * into v_ref from public.billing_refunds where id = p_refund for update;
  if v_ref.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_ref.status <> 'requested' then raise exception 'not_pending' using errcode = '22023'; end if;
  if v_ref.requested_by = auth.uid() then raise exception 'self_approval_forbidden' using errcode = '42501'; end if;
  update public.billing_refunds
     set status = case p_decision when 'approve' then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = v_ref.id;
  perform public.console_audit_internal(v_role, 'billing.refund_' || case p_decision when 'approve' then 'approved' else 'rejected' end,
    'refund', 'REF-' || lpad(v_ref.refund_no::text, 4, '0'));
  return case p_decision when 'approve' then 'approved' else 'rejected' end;
end;
$$;

-- Mark an approved refund as paid out. The payout itself happens outside the
-- console (e.g. a Mobile Money transfer); this records its reference.
create function public.console_billing_refund_process(p_refund uuid, p_payout_reference text)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_ref public.billing_refunds%rowtype;
begin
  v_role := public.console_assert('approve_refunds');
  if char_length(btrim(coalesce(p_payout_reference, ''))) < 3 then raise exception 'reference_required' using errcode = '22023'; end if;
  select * into v_ref from public.billing_refunds where id = p_refund for update;
  if v_ref.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_ref.status = 'processed' then return 'processed'; end if;  -- idempotent
  if v_ref.status <> 'approved' then raise exception 'not_approved' using errcode = '22023'; end if;
  update public.billing_refunds
     set status = 'processed', payout_reference = btrim(p_payout_reference), processed_by = auth.uid(), processed_at = now()
   where id = v_ref.id;
  perform public.console_audit_internal(v_role, 'billing.refund_processed', 'refund', 'REF-' || lpad(v_ref.refund_no::text, 4, '0'),
    'success', jsonb_build_object('amount_rwf', v_ref.amount_rwf));
  return 'processed';
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'console_billing_overview(integer)',
    'console_billing_subscriptions(text,integer,timestamptz)',
    'console_billing_subscription_get(uuid)',
    'console_billing_payments(text,text,integer,timestamptz)',
    'console_billing_analytics(integer)',
    'console_billing_workspace_lookup(text)',
    'console_billing_create_subscription(uuid,text,text)',
    'console_billing_record_payment(uuid,text,text,text)',
    'console_billing_settle_payment(uuid,text)',
    'console_billing_set_reconciliation(uuid,text,text)',
    'console_billing_cancel(uuid,boolean,text)',
    'console_billing_roll_periods()',
    'console_billing_refunds(text,integer)',
    'console_billing_refund_request(uuid,integer,text)',
    'console_billing_refund_decide(uuid,text,text)',
    'console_billing_refund_process(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
