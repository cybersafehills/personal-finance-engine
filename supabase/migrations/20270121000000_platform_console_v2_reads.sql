-- Platform Console v2: read functions for Activity Center, Registrations,
-- Organizations, Reports & Intelligence, Security Center and the customer
-- detail drawer.
--
-- Same contract as 20270120000000: SECURITY DEFINER, every function starts
-- with console_assert(<permission>) (signed in + aal2 + active staff +
-- permission), returns aggregates / masked metadata ONLY. No email, phone,
-- transaction rows, descriptions, amounts or balances are reachable.

-- ---------------------------------------------------------------------------
-- Activity Center: paged, filterable activity feed
-- ---------------------------------------------------------------------------
create function public.console_activity_page(
  p_limit integer default 50,
  p_before timestamptz default null,
  p_type text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_role text;
  v_can_audit boolean;
  v_result jsonb;
begin
  v_role := public.console_assert('view_aggregate_metrics');
  if p_type is not null and p_type not in ('registration', 'admin_action') then
    raise exception 'invalid_type' using errcode = '22023';
  end if;
  v_can_audit := exists (
    select 1 from public.console_role_permissions rp
    where rp.role = v_role and rp.permission = 'view_audit_logs');

  select coalesce(jsonb_agg(row_to_json(e) order by e.occurred_at desc), '[]'::jsonb)
  into v_result
  from (
    select * from (
      select
        p.created_at as occurred_at,
        'registration'::text as event_type,
        'New registration'::text as event,
        'Customers'::text as category,
        ('Customer ' || left(p.id::text, 8))::text as subject,
        case when p.status = 'suspended' then 'restricted' else 'completed' end as status,
        null::text as operator_role
      from public.profiles p
      where p_type is null or p_type = 'registration'
      union all
      select
        a.created_at, 'admin_action', a.action, 'Administration',
        coalesce(a.target_type || ' ' || left(a.target_id, 8), 'Console'),
        a.outcome, a.actor_role
      from public.console_audit_events a
      where v_can_audit and (p_type is null or p_type = 'admin_action')
    ) u
    where p_before is null or u.occurred_at < p_before
    order by u.occurred_at desc
    limit v_limit
  ) e;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Registrations: derived state (no manual approval exists, so none is faked)
--   restricted            profile suspended
--   pending_verification  auth email not yet confirmed
--   incomplete            confirmed, onboarding not finished
--   verified              confirmed and onboarding completed
-- ---------------------------------------------------------------------------
create function public.console_registrations(
  p_state text default null,
  p_limit integer default 25,
  p_before_created timestamptz default null,
  p_before_id uuid default null
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
  perform public.console_assert('view_customer_metadata');
  if p_state is not null and p_state not in
     ('restricted', 'pending_verification', 'incomplete', 'verified') then
    raise exception 'invalid_state' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'counts', (
      select coalesce(jsonb_object_agg(s.state, s.n), '{}'::jsonb)
      from (
        select state, count(*) as n from (
          select case
            when p.status = 'suspended' then 'restricted'
            when u.email_confirmed_at is null then 'pending_verification'
            when p.onboarding_step <> 'completed' then 'incomplete'
            else 'verified' end as state
          from public.profiles p join auth.users u on u.id = p.id
        ) x group by state
      ) s
    ),
    'rows', coalesce((
      select jsonb_agg(row_to_json(r) order by r.created_at desc, r.id desc)
      from (
        select * from (
          select
            p.id, left(p.id::text, 8) as customer_ref, p.display_name,
            p.created_at, p.onboarding_step,
            case
              when p.status = 'suspended' then 'restricted'
              when u.email_confirmed_at is null then 'pending_verification'
              when p.onboarding_step <> 'completed' then 'incomplete'
              else 'verified' end as state,
            case
              when p.status = 'suspended' then 'Account restricted'
              when u.email_confirmed_at is null then 'Customer must confirm their email'
              when p.onboarding_step <> 'completed' then 'Customer is mid-onboarding (' || p.onboarding_step || ')'
              else 'None' end as required_action
          from public.profiles p join auth.users u on u.id = p.id
        ) q
        where (p_state is null or q.state = p_state)
          and (p_before_created is null
               or (q.created_at, q.id) < (p_before_created,
                    coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
        order by q.created_at desc, q.id desc
        limit v_limit
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizations (business workspaces)
-- ---------------------------------------------------------------------------
create function public.console_organizations(
  p_search text default null,
  p_limit integer default 25,
  p_before_created timestamptz default null,
  p_before_id uuid default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_search text := nullif(btrim(p_search), '');
begin
  perform public.console_assert('view_customer_metadata');
  return jsonb_build_object(
    'totals', jsonb_build_object(
      'organizations', (select count(*) from public.workspaces where kind = 'organization'),
      'active', (select count(*) from public.workspaces where kind = 'organization' and status = 'active')
    ),
    'rows', coalesce((
      select jsonb_agg(row_to_json(o) order by o.created_at desc, o.id desc)
      from (
        select
          w.id, left(w.id::text, 8) as org_ref, w.name, w.status, w.created_at,
          (select count(*) from public.workspace_memberships m
            where m.workspace_id = w.id and m.status = 'active') as members,
          (select wp.plan from public.workspace_plans wp where wp.workspace_id = w.id) as plan,
          (select max(t.created_at) from public.transactions t
            where t.workspace_id = w.id) as last_activity
        from public.workspaces w
        where w.kind = 'organization'
          and (v_search is null
               or w.name ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
               or w.id::text like lower(replace(replace(v_search, '%', ''), '_', '')) || '%')
          and (p_before_created is null
               or (w.created_at, w.id) < (p_before_created,
                    coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
        order by w.created_at desc, w.id desc
        limit v_limit
      ) o
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports & Intelligence: monthly growth + activation funnel (counts only)
-- ---------------------------------------------------------------------------
create function public.console_reports_overview(p_months integer default 12)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_months integer := greatest(3, least(coalesce(p_months, 12), 36));
  v_from date;
begin
  perform public.console_assert('view_aggregate_metrics');
  v_from := (date_trunc('month', now() at time zone 'Africa/Kigali')
             - make_interval(months => v_months - 1))::date;

  return jsonb_build_object(
    'generated_at', now(),
    'registrations_by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'count', coalesce(c.n, 0)) order by m.month)
      from generate_series(v_from, (now() at time zone 'Africa/Kigali')::date, interval '1 month') as m(month)
      left join (
        select date_trunc('month', created_at at time zone 'Africa/Kigali')::date as month, count(*) as n
        from public.profiles group by 1
      ) c on c.month = m.month::date
    ), '[]'::jsonb),
    'funnel', jsonb_build_array(
      jsonb_build_object('step', 'registered',
        'count', (select count(*) from public.profiles)),
      jsonb_build_object('step', 'email_confirmed',
        'count', (select count(*) from public.profiles p join auth.users u on u.id = p.id
                   where u.email_confirmed_at is not null)),
      jsonb_build_object('step', 'onboarding_completed',
        'count', (select count(*) from public.profiles where onboarding_step = 'completed')),
      jsonb_build_object('step', 'account_added',
        'count', (select count(distinct m.user_id) from public.workspace_memberships m
                   join public.accounts a on a.workspace_id = m.workspace_id
                  where m.status = 'active')),
      jsonb_build_object('step', 'first_transaction',
        'count', (select count(distinct m.user_id) from public.workspace_memberships m
                   where m.status = 'active'
                     and exists (select 1 from public.transactions t where t.workspace_id = m.workspace_id)))
    ),
    'workspace_kinds', coalesce((
      select jsonb_agg(jsonb_build_object('kind', kind, 'count', n))
      from (select kind, count(*) as n from public.workspaces group by kind) k
    ), '[]'::jsonb),
    'plan_distribution', coalesce((
      select jsonb_agg(jsonb_build_object('plan', plan, 'count', n) order by n desc)
      from (select plan, count(*) as n from public.workspace_plans group by plan) p
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Security Center: posture + recent privileged activity (aggregates)
-- ---------------------------------------------------------------------------
create function public.console_security_overview()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
begin
  perform public.console_assert('view_audit_logs');
  return jsonb_build_object(
    'generated_at', now(),
    'staff', jsonb_build_object(
      'active', (select count(*) from public.console_staff where status = 'active'),
      'suspended', (select count(*) from public.console_staff where status = 'suspended'),
      'with_verified_mfa', (select count(*) from public.console_staff s
          where s.status = 'active' and exists (
            select 1 from auth.mfa_factors f
             where f.user_id = s.user_id and f.status = 'verified')),
      'by_role', coalesce((
        select jsonb_agg(jsonb_build_object('role', role, 'count', n) order by n desc)
        from (select role, count(*) as n from public.console_staff
               where status = 'active' group by role) r
      ), '[]'::jsonb)
    ),
    'audit_7d', jsonb_build_object(
      'total', (select count(*) from public.console_audit_events
                 where created_at >= now() - interval '7 days'),
      'denied', (select count(*) from public.console_audit_events
                  where created_at >= now() - interval '7 days' and outcome = 'denied'),
      'failed', (select count(*) from public.console_audit_events
                  where created_at >= now() - interval '7 days' and outcome = 'failed'),
      'top_actions', coalesce((
        select jsonb_agg(jsonb_build_object('action', action, 'count', n) order by n desc)
        from (select action, count(*) as n from public.console_audit_events
               where created_at >= now() - interval '7 days'
               group by action order by n desc limit 6) a
      ), '[]'::jsonb)
    ),
    'customer_logins_24h', jsonb_build_object(
      'succeeded', (select count(*) from public.auth_login_attempts
                     where created_at >= now() - interval '24 hours' and succeeded),
      'failed', (select count(*) from public.auth_login_attempts
                  where created_at >= now() - interval '24 hours' and not succeeded)
    ),
    'recent_denials', coalesce((
      select jsonb_agg(row_to_json(d) order by d.created_at desc)
      from (select created_at, actor_role, action, target_id
              from public.console_audit_events
             where outcome = 'denied' order by created_at desc limit 8) d
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer detail drawer: metadata only (no email, no financial rows)
-- ---------------------------------------------------------------------------
create function public.console_customer_detail(p_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_result jsonb;
begin
  perform public.console_assert('view_customer_metadata');

  select jsonb_build_object(
    'id', p.id,
    'customer_ref', left(p.id::text, 8),
    'display_name', p.display_name,
    'status', p.status,
    'created_at', p.created_at,
    'locale', p.locale,
    'timezone', p.timezone,
    'onboarding_step', p.onboarding_step,
    'email_confirmed', (u.email_confirmed_at is not null),
    'mfa_enrolled', exists (select 1 from auth.mfa_factors f
                             where f.user_id = p.id and f.status = 'verified'),
    'last_sign_in_at', u.last_sign_in_at,
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', left(w.id::text, 8), 'name', w.name, 'kind', w.kind,
        'member_role', m.role, 'status', w.status,
        'plan', (select wp.plan from public.workspace_plans wp where wp.workspace_id = w.id),
        'accounts', (select count(*) from public.accounts a where a.workspace_id = w.id),
        'connections', (select count(*) from public.ingestion_connections c
                         where c.workspace_id = w.id and c.status = 'active'),
        'last_activity', (select max(t.created_at) from public.transactions t
                           where t.workspace_id = w.id)
      ) order by w.created_at)
      from public.workspace_memberships m
      join public.workspaces w on w.id = m.workspace_id
      where m.user_id = p.id and m.status = 'active'
    ), '[]'::jsonb)
  ) into v_result
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = p_id;

  if v_result is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'console_activity_page(integer,timestamptz,text)',
    'console_registrations(text,integer,timestamptz,uuid)',
    'console_organizations(text,integer,timestamptz,uuid)',
    'console_reports_overview(integer)',
    'console_security_overview()',
    'console_customer_detail(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
